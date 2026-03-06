// ---------------------------------------------------------------------------
// nit — Update check
//
// Non-blocking check against npm registry. Caches result for 24 hours.
// Never throws — returns null on any failure.
// ---------------------------------------------------------------------------

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
