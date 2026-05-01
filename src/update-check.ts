// ---------------------------------------------------------------------------
// nit — Update check
//
// Non-blocking check against npm registry. Caches result for 24 hours.
// Never throws — returns null on any failure.
// ---------------------------------------------------------------------------

import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { fetchWithTimeout, readResponseJson } from './http.js';

declare const __NIT_VERSION__: string;

const CACHE_PATH = join(homedir(), '.nit-update-cache.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 day
const FETCH_TIMEOUT_MS = 3_000; // 3s — never slow down the CLI
const MAX_NPM_RESPONSE_BYTES = 16 * 1024;
const REGISTRY_URL = 'https://registry.npmjs.org/@newtype-ai/nit/latest';

export type UpdateMode = 'install' | 'notify' | 'off';

interface Cache {
  lastChecked: number;
  latestVersion: string;
}

export interface UpdateInfo {
  current: string;
  latest: string;
}

export interface CheckForUpdateOptions {
  force?: boolean;
  fetchImpl?: typeof fetch;
  cachePath?: string;
  now?: () => number;
}

type EnvLike = Record<string, string | undefined>;
type ExecFileLike = (file: string, args: string[], options: Record<string, unknown>) => unknown;
type Writer = { write: (message: string) => unknown };

export interface AutoUpdateOptions {
  env?: EnvLike;
  check?: () => Promise<UpdateInfo | null>;
  execFile?: ExecFileLike;
  stderr?: Writer;
  argv?: string[];
  reexec?: boolean;
  exit?: (code?: number) => void;
}

export interface InstallUpdateOptions {
  execFile?: ExecFileLike;
}

function getCurrentVersion(): string {
  try {
    return __NIT_VERSION__;
  } catch {
    return '0.0.0';
  }
}

export const version = getCurrentVersion();

function isNewer(latest: string, current: string): boolean {
  const a = latest.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return false;
}

function isPlainSemver(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version);
}

function parseUpdateMode(value: string): UpdateMode | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'install' || normalized === 'notify' || normalized === 'off') {
    return normalized;
  }
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return 'install';
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return 'off';
  return null;
}

export function resolveAutoUpdateMode(env: EnvLike = process.env): { mode: UpdateMode; warning?: string } {
  if (env.CI === 'true' || env.CI === '1') {
    return { mode: 'off' };
  }

  if (env.NIT_NO_AUTO_UPDATE === '1') {
    return { mode: 'off' };
  }

  const configured = env.NIT_AUTO_UPDATE;
  if (!configured) {
    return { mode: 'install' };
  }

  const mode = parseUpdateMode(configured);
  if (!mode) {
    return {
      mode: 'off',
      warning: `nit: invalid NIT_AUTO_UPDATE="${configured}". Use install, notify, or off.\n`,
    };
  }

  return { mode };
}

export function manualInstallCommand(latest: string): string {
  return `npm install -g @newtype-ai/nit@${latest}`;
}

async function readCache(path = CACHE_PATH): Promise<Cache | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<Cache>;
    if (
      typeof parsed.lastChecked === 'number' &&
      typeof parsed.latestVersion === 'string' &&
      isPlainSemver(parsed.latestVersion)
    ) {
      return { lastChecked: parsed.lastChecked, latestVersion: parsed.latestVersion };
    }
    return null;
  } catch {
    return null;
  }
}

async function writeCache(cache: Cache, path = CACHE_PATH): Promise<void> {
  try {
    await writeFile(path, JSON.stringify(cache), 'utf-8');
  } catch {
    // Ignore — cache is best-effort
  }
}

/**
 * Check if a newer version of nit is available on npm.
 * Returns the latest version string if outdated, null otherwise.
 * Never throws.
 */
export async function checkForUpdate(options: CheckForUpdateOptions = {}): Promise<UpdateInfo | null> {
  const current = getCurrentVersion();
  const now = options.now ?? Date.now;
  const cachePath = options.cachePath ?? CACHE_PATH;

  // Check cache first
  const cache = options.force ? null : await readCache(cachePath);
  if (cache && now() - cache.lastChecked < CHECK_INTERVAL_MS) {
    return isNewer(cache.latestVersion, current)
      ? { current, latest: cache.latestVersion }
      : null;
  }

  try {
    const res = await fetchWithTimeout(REGISTRY_URL, {
      headers: { Accept: 'application/json' },
    }, {
      fetchImpl: options.fetchImpl,
      label: 'Update check',
      timeoutMs: FETCH_TIMEOUT_MS,
    });

    if (!res.ok) return null;

    const data = await readResponseJson<{ version?: string }>(res, 'npm latest response', MAX_NPM_RESPONSE_BYTES);
    const latest = data.version;
    if (!latest) return null;
    if (!isPlainSemver(latest)) return null;

    // Cache the result
    await writeCache({ lastChecked: now(), latestVersion: latest }, cachePath);

    return isNewer(latest, current) ? { current, latest } : null;
  } catch {
    return null;
  }
}

export function installNitVersion(latest: string, options: InstallUpdateOptions = {}): void {
  if (!isPlainSemver(latest)) {
    throw new Error(`invalid npm version "${latest}"`);
  }

  const run = options.execFile ?? (execFileSync as ExecFileLike);
  run('npm', ['install', '-g', `@newtype-ai/nit@${latest}`], {
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: 30_000,
  });
}

/**
 * Auto-update nit if a newer version is available on npm.
 * Intended for CLI use only — never call from the library API.
 *
 * On success, re-executes the current command with the updated binary
 * and exits. On failure, warns and returns (caller continues with
 * current version).
 */
export async function autoUpdate(options: AutoUpdateOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  const stderr = options.stderr ?? process.stderr;
  const policy = resolveAutoUpdateMode(env);

  if (policy.warning) {
    stderr.write(policy.warning);
  }

  if (policy.mode === 'off') {
    return;
  }

  const update = await (options.check ? options.check() : checkForUpdate()).catch(() => null);
  if (!update) return;

  const { current, latest } = update;
  if (!isPlainSemver(latest)) {
    stderr.write(`nit: skipped auto-update for invalid npm version "${latest}"\n`);
    return;
  }

  if (policy.mode === 'notify') {
    stderr.write(`nit: update available ${current} -> ${latest}. Run: ${manualInstallCommand(latest)}\n`);
    return;
  }

  stderr.write(`nit: updating ${current} -> ${latest} - https://github.com/newtype-ai/nit/releases/tag/v${latest}\n`);

  try {
    installNitVersion(latest, { execFile: options.execFile });
  } catch {
    stderr.write(`nit: auto-update failed. Run manually: ${manualInstallCommand(latest)}\n`);
    return;
  }

  if (options.reexec === false) {
    return;
  }

  // Re-exec with explicit args (no shell interpolation)
  const run = options.execFile ?? (execFileSync as ExecFileLike);
  const argv = options.argv ?? process.argv.slice(2);
  const exit = options.exit ?? ((code?: number) => { process.exit(code); });
  try {
    run('nit', argv, { stdio: 'inherit', timeout: 60_000 });
    exit(0);
  } catch (err) {
    // Forward the exit code from the re-exec'd process
    const code = (err as { status?: number }).status ?? 1;
    exit(code);
  }
}
