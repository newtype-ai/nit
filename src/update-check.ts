// ---------------------------------------------------------------------------
// nit — Update check
//
// Non-blocking check against npm registry. Caches result for 24 hours.
// Never throws — returns null on any failure.
// ---------------------------------------------------------------------------

import { execSync, execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

declare const __NIT_VERSION__: string;

const CACHE_PATH = join(homedir(), '.nit-update-cache.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 day
const FETCH_TIMEOUT_MS = 3_000; // 3s — never slow down the CLI
const REGISTRY_URL = 'https://registry.npmjs.org/@newtype-ai/nit/latest';

interface Cache {
  lastChecked: number;
  latestVersion: string;
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

async function readCache(): Promise<Cache | null> {
  try {
    const raw = await readFile(CACHE_PATH, 'utf-8');
    return JSON.parse(raw) as Cache;
  } catch {
    return null;
  }
}

async function writeCache(cache: Cache): Promise<void> {
  try {
    await writeFile(CACHE_PATH, JSON.stringify(cache), 'utf-8');
  } catch {
    // Ignore — cache is best-effort
  }
}

/**
 * Check if a newer version of nit is available on npm.
 * Returns the latest version string if outdated, null otherwise.
 * Never throws.
 */
export async function checkForUpdate(): Promise<{ current: string; latest: string } | null> {
  const current = getCurrentVersion();

  // Check cache first
  const cache = await readCache();
  if (cache && Date.now() - cache.lastChecked < CHECK_INTERVAL_MS) {
    return isNewer(cache.latestVersion, current)
      ? { current, latest: cache.latestVersion }
      : null;
  }

  // Fetch from npm registry with timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(REGISTRY_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) return null;

    const data = (await res.json()) as { version?: string };
    const latest = data.version;
    if (!latest) return null;

    // Cache the result
    await writeCache({ lastChecked: Date.now(), latestVersion: latest });

    return isNewer(latest, current) ? { current, latest } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Auto-update nit if a newer version is available on npm.
 * Intended for CLI use only — never call from the library API.
 *
 * On success, re-executes the current command with the updated binary
 * and exits. On failure, warns and returns (caller continues with
 * current version).
 */
export async function autoUpdate(): Promise<void> {
  const update = await checkForUpdate().catch(() => null);
  if (!update) return;

  const { current, latest } = update;
  process.stderr.write(`nit: updating ${current} → ${latest} — https://github.com/newtype-ai/nit/releases/tag/v${latest}\n`);

  try {
    // TODO: Verify npm provenance/signatures before installing
    // See: https://docs.npmjs.com/generating-provenance-statements
    execSync(`npm install -g @newtype-ai/nit@${latest}`, {
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 30_000,
    });
  } catch {
    process.stderr.write(`nit: auto-update failed. Run manually: npm install -g @newtype-ai/nit\n`);
    return;
  }

  // Re-exec with explicit args (no shell interpolation)
  try {
    const args = process.argv.slice(2);
    execFileSync('nit', args, { stdio: 'inherit', timeout: 60_000 });
    process.exit(0);
  } catch (err) {
    // Forward the exit code from the re-exec'd process
    const code = (err as { status?: number }).status ?? 1;
    process.exit(code);
  }
}
