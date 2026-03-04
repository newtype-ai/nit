// ---------------------------------------------------------------------------
// nit — .nit/config read/write
//
// Git-style INI format storing configuration:
//
//   [remote "origin"]
//     url = https://api.newtype-ai.org
//     credential = abc123token
//
//   [skills]
//     dir = /home/agent/.claude/skills
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

/**
 * Get the URL for a named remote, or null if not set.
 */
export async function getRemoteUrl(
  nitDir: string,
  remoteName: string,
): Promise<string | null> {
  const config = await readConfig(nitDir);
  return config.remotes[remoteName]?.url ?? null;
}

/**
 * Set (or update) the URL for a named remote.
 */
export async function setRemoteUrl(
  nitDir: string,
  remoteName: string,
  url: string,
): Promise<void> {
  const config = await readConfig(nitDir);

  if (!config.remotes[remoteName]) {
    config.remotes[remoteName] = {};
  }
  config.remotes[remoteName].url = url;

  await writeConfig(nitDir, config);
}

/**
 * Get the configured skills directory, or null if not set.
 */
export async function getSkillsDir(
  nitDir: string,
): Promise<string | null> {
  const config = await readConfig(nitDir);
  return config.skillsDir ?? null;
}

/**
 * Set the skills directory in config.
 */
export async function setSkillsDir(
  nitDir: string,
  dir: string,
): Promise<void> {
  const config = await readConfig(nitDir);
  config.skillsDir = dir;
  await writeConfig(nitDir, config);
}

// ---------------------------------------------------------------------------
// INI parser / serializer
// ---------------------------------------------------------------------------

function parseConfig(raw: string): NitConfig {
  const remotes: Record<string, NitRemoteConfig> = {};
  let currentSection: string | null = null;
  let currentRemote: string | null = null;
  let skillsDir: string | undefined;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // Section header: [remote "name"]
    const remoteMatch = trimmed.match(/^\[remote\s+"([^"]+)"\]$/);
    if (remoteMatch) {
      currentSection = 'remote';
      currentRemote = remoteMatch[1];
      if (!remotes[currentRemote]) {
        remotes[currentRemote] = {};
      }
      continue;
    }

    // Section header: [skills]
    if (trimmed === '[skills]') {
      currentSection = 'skills';
      currentRemote = null;
      continue;
    }

    // Key-value pair: key = value
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const [, key, value] = kvMatch;
      if (currentSection === 'remote' && currentRemote !== null) {
        if (key === 'url') {
          remotes[currentRemote].url = value.trim();
        } else if (key === 'credential') {
          remotes[currentRemote].credential = value.trim();
        }
      } else if (currentSection === 'skills') {
        if (key === 'dir') {
          skillsDir = value.trim();
        }
      }
    }
  }

  return { remotes, skillsDir };
}

function serializeConfig(config: NitConfig): string {
  const lines: string[] = [];

  for (const [name, remote] of Object.entries(config.remotes)) {
    lines.push(`[remote "${name}"]`);
    if (remote.url) {
      lines.push(`  url = ${remote.url}`);
    }
    if (remote.credential) {
      lines.push(`  credential = ${remote.credential}`);
    }
    lines.push('');
  }

  if (config.skillsDir) {
    lines.push('[skills]');
    lines.push(`  dir = ${config.skillsDir}`);
    lines.push('');
  }

  return lines.join('\n');
}
