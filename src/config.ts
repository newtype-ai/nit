// ---------------------------------------------------------------------------
// nit — .nit/config read/write
//
// Git-style INI format storing push credentials per remote:
//
//   [remote "origin"]
//     credential = abc123token
//
//   [remote "backup"]
//     credential = xyz789token
// ---------------------------------------------------------------------------

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { NitConfig, NitRemoteConfig } from './types.js';

const CONFIG_FILE = 'config';

/**
 * Read and parse the .nit/config file.
 * Returns an empty config if the file does not exist.
 */
export async function readConfig(nitDir: string): Promise<NitConfig> {
  const configPath = join(nitDir, CONFIG_FILE);

  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf-8');
  } catch {
    return { remotes: {} };
  }

  return parseConfig(raw);
}

/**
 * Write the config object back to .nit/config.
 */
export async function writeConfig(
  nitDir: string,
  config: NitConfig,
): Promise<void> {
  const configPath = join(nitDir, CONFIG_FILE);
  await fs.writeFile(configPath, serializeConfig(config), 'utf-8');
}

/**
 * Get the push credential for a named remote, or null if not set.
 */
export async function getRemoteCredential(
  nitDir: string,
  remoteName: string,
): Promise<string | null> {
  const config = await readConfig(nitDir);
  return config.remotes[remoteName]?.credential ?? null;
}

/**
 * Set (or update) the push credential for a named remote.
 */
export async function setRemoteCredential(
  nitDir: string,
  remoteName: string,
  credential: string,
): Promise<void> {
  const config = await readConfig(nitDir);

  if (!config.remotes[remoteName]) {
    config.remotes[remoteName] = {};
  }
  config.remotes[remoteName].credential = credential;

  await writeConfig(nitDir, config);
}

// ---------------------------------------------------------------------------
// INI parser / serializer (minimal, handles only the remote section format)
// ---------------------------------------------------------------------------

function parseConfig(raw: string): NitConfig {
  const remotes: Record<string, NitRemoteConfig> = {};
  let currentRemote: string | null = null;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // Section header: [remote "name"]
    const sectionMatch = trimmed.match(/^\[remote\s+"([^"]+)"\]$/);
    if (sectionMatch) {
      currentRemote = sectionMatch[1];
      if (!remotes[currentRemote]) {
        remotes[currentRemote] = {};
      }
      continue;
    }

    // Key-value pair: key = value
    if (currentRemote !== null) {
      const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
      if (kvMatch) {
        const [, key, value] = kvMatch;
        if (key === 'credential') {
          remotes[currentRemote].credential = value.trim();
        }
      }
    }
  }

  return { remotes };
}

function serializeConfig(config: NitConfig): string {
  const lines: string[] = [];

  for (const [name, remote] of Object.entries(config.remotes)) {
    lines.push(`[remote "${name}"]`);
    if (remote.credential) {
      lines.push(`  credential = ${remote.credential}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
