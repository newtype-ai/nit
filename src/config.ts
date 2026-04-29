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
import type {
  AgentRuntime,
  NitConfig,
  NitRemoteConfig,
  NitRpcConfig,
  NitSkillConfig,
  NitSkillSource,
} from './types.js';
import {
  validateConfigValue,
  validateHttpUrl,
  validateRemoteName,
  validateRpcChainName,
} from './validation.js';

const CONFIG_FILE = 'config';
const NIT_SKILL_SOURCES: NitSkillSource[] = ['newtype', 'url', 'embedded', 'none'];

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
  validateRemoteName(remoteName);
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
  validateRemoteName(remoteName);
  validateConfigValue(credential, 'Remote credential');
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
  validateRemoteName(remoteName);
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
  validateRemoteName(remoteName);
  validateHttpUrl(url, 'Remote URL');
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
  validateConfigValue(dir, 'Skills directory');
  const config = await readConfig(nitDir);
  config.skillsDir = dir;
  await writeConfig(nitDir, config);
}

export function validateNitSkillConfig(config: NitSkillConfig): void {
  if (!NIT_SKILL_SOURCES.includes(config.source)) {
    throw new Error(`nit skill source must be one of: ${NIT_SKILL_SOURCES.join(', ')}`);
  }
  if ((config.source === 'newtype' || config.source === 'url') && config.url) {
    validateHttpUrl(config.url, 'nit skill URL');
  }
  if ((config.source === 'embedded' || config.source === 'none') && config.url) {
    throw new Error(`nit skill source "${config.source}" must not set a URL`);
  }
  if (config.source === 'url' && !config.url) {
    throw new Error('nit skill source "url" requires a URL');
  }
}

export async function getNitSkillConfig(
  nitDir: string,
): Promise<NitSkillConfig | null> {
  const config = await readConfig(nitDir);
  return config.nitSkill ?? null;
}

export async function setNitSkillConfig(
  nitDir: string,
  nitSkill: NitSkillConfig,
): Promise<void> {
  validateNitSkillConfig(nitSkill);
  const config = await readConfig(nitDir);
  config.nitSkill = nitSkill;
  await writeConfig(nitDir, config);
}

/**
 * Get the RPC URL for a chain, or null if not set.
 */
export async function getRpcUrl(
  nitDir: string,
  chain: string,
): Promise<string | null> {
  validateRpcChainName(chain);
  const config = await readConfig(nitDir);
  return config.rpc?.[chain]?.url ?? null;
}

/**
 * Set (or update) the RPC URL for a chain.
 */
export async function setRpcUrl(
  nitDir: string,
  chain: string,
  url: string,
): Promise<void> {
  validateRpcChainName(chain);
  validateHttpUrl(url, 'RPC URL');
  const config = await readConfig(nitDir);

  if (!config.rpc) {
    config.rpc = {};
  }
  config.rpc[chain] = { url };

  await writeConfig(nitDir, config);
}

// ---------------------------------------------------------------------------
// Runtime (self-declared LLM provider identity)
// ---------------------------------------------------------------------------

const PROVIDER_RE = /^[a-z0-9-]+$/;
const MAX_RUNTIME_FIELD_LEN = 100;

function validateRuntimeField(value: string, label: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  validateConfigValue(value, label);
  if (value.length > MAX_RUNTIME_FIELD_LEN) {
    throw new Error(`${label} must be at most ${MAX_RUNTIME_FIELD_LEN} characters`);
  }
}

/**
 * Set (or update) the self-declared runtime attestation.
 * `provider` must be lowercase letters, digits, and hyphens only.
 */
export async function setRuntime(
  nitDir: string,
  provider: string,
  model: string,
  harness: string,
): Promise<AgentRuntime> {
  validateRuntimeField(provider, 'runtime.provider');
  validateRuntimeField(model, 'runtime.model');
  validateRuntimeField(harness, 'runtime.harness');
  if (!PROVIDER_RE.test(provider)) {
    throw new Error('runtime.provider must contain only lowercase letters, digits, and hyphens');
  }
  const runtime: AgentRuntime = {
    provider,
    model,
    harness,
    declared_at: Math.floor(Date.now() / 1000),
  };
  const config = await readConfig(nitDir);
  config.runtime = runtime;
  await writeConfig(nitDir, config);
  return runtime;
}

/**
 * Get the configured runtime, or null if not set.
 */
export async function getRuntime(
  nitDir: string,
): Promise<AgentRuntime | null> {
  const config = await readConfig(nitDir);
  return config.runtime ?? null;
}

/**
 * Clear the runtime from config.
 */
export async function clearRuntime(nitDir: string): Promise<void> {
  const config = await readConfig(nitDir);
  delete config.runtime;
  await writeConfig(nitDir, config);
}

// ---------------------------------------------------------------------------
// INI parser / serializer
// ---------------------------------------------------------------------------

function parseConfig(raw: string): NitConfig {
  const remotes: Record<string, NitRemoteConfig> = {};
  const rpc: Record<string, NitRpcConfig> = {};
  let currentSection: string | null = null;
  let currentRemote: string | null = null;
  let currentRpcChain: string | null = null;
  let currentNitSubsection: string | null = null;
  let skillsDir: string | undefined;
  const nitSkillFields: Partial<Record<'source' | 'url', string>> = {};
  const runtimeFields: Partial<Record<'provider' | 'model' | 'harness' | 'declared_at', string>> = {};

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // Section header: [remote "name"]
    const remoteMatch = trimmed.match(/^\[remote\s+"([^"]+)"\]$/);
    if (remoteMatch) {
      currentSection = 'remote';
      currentRemote = remoteMatch[1];
      currentRpcChain = null;
      currentNitSubsection = null;
      if (!remotes[currentRemote]) {
        remotes[currentRemote] = {};
      }
      continue;
    }

    // Section header: [rpc "chain"]
    const rpcMatch = trimmed.match(/^\[rpc\s+"([^"]+)"\]$/);
    if (rpcMatch) {
      currentSection = 'rpc';
      currentRpcChain = rpcMatch[1];
      currentRemote = null;
      currentNitSubsection = null;
      continue;
    }

    // Section header: [nit "skill"]
    const nitMatch = trimmed.match(/^\[nit\s+"([^"]+)"\]$/);
    if (nitMatch) {
      currentSection = 'nit';
      currentNitSubsection = nitMatch[1];
      currentRemote = null;
      currentRpcChain = null;
      continue;
    }

    // Section header: [skills]
    if (trimmed === '[skills]') {
      currentSection = 'skills';
      currentRemote = null;
      currentRpcChain = null;
      currentNitSubsection = null;
      continue;
    }

    // Section header: [runtime]
    if (trimmed === '[runtime]') {
      currentSection = 'runtime';
      currentRemote = null;
      currentRpcChain = null;
      currentNitSubsection = null;
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
      } else if (currentSection === 'rpc' && currentRpcChain !== null) {
        if (key === 'url') {
          rpc[currentRpcChain] = { url: value.trim() };
        }
      } else if (currentSection === 'skills') {
        if (key === 'dir') {
          skillsDir = value.trim();
        }
      } else if (currentSection === 'runtime') {
        if (key === 'provider' || key === 'model' || key === 'harness' || key === 'declared_at') {
          runtimeFields[key] = value.trim();
        }
      } else if (currentSection === 'nit' && currentNitSubsection === 'skill') {
        if (key === 'source' || key === 'url') {
          nitSkillFields[key] = value.trim();
        }
      }
    }
  }

  const config: NitConfig = { remotes, skillsDir };
  if (Object.keys(rpc).length > 0) {
    config.rpc = rpc;
  }
  if (runtimeFields.provider && runtimeFields.model && runtimeFields.harness && runtimeFields.declared_at) {
    const declaredAt = parseInt(runtimeFields.declared_at, 10);
    if (Number.isFinite(declaredAt)) {
      config.runtime = {
        provider: runtimeFields.provider,
        model: runtimeFields.model,
        harness: runtimeFields.harness,
        declared_at: declaredAt,
      };
    }
  }
  if (nitSkillFields.source) {
    const nitSkill: NitSkillConfig = {
      source: nitSkillFields.source as NitSkillSource,
    };
    if (nitSkillFields.url) {
      nitSkill.url = nitSkillFields.url;
    }
    validateNitSkillConfig(nitSkill);
    config.nitSkill = nitSkill;
  }
  return config;
}

function serializeConfig(config: NitConfig): string {
  const lines: string[] = [];

  for (const [name, remote] of Object.entries(config.remotes)) {
    validateRemoteName(name);
    lines.push(`[remote "${name}"]`);
    if (remote.url) {
      validateHttpUrl(remote.url, `Remote URL for "${name}"`);
      lines.push(`  url = ${remote.url}`);
    }
    if (remote.credential) {
      validateConfigValue(remote.credential, `Remote credential for "${name}"`);
      lines.push(`  credential = ${remote.credential}`);
    }
    lines.push('');
  }

  if (config.rpc) {
    for (const [chain, rpcConfig] of Object.entries(config.rpc)) {
      validateRpcChainName(chain);
      validateHttpUrl(rpcConfig.url, `RPC URL for "${chain}"`);
      lines.push(`[rpc "${chain}"]`);
      lines.push(`  url = ${rpcConfig.url}`);
      lines.push('');
    }
  }

  if (config.skillsDir) {
    validateConfigValue(config.skillsDir, 'Skills directory');
    lines.push('[skills]');
    lines.push(`  dir = ${config.skillsDir}`);
    lines.push('');
  }

  if (config.nitSkill) {
    validateNitSkillConfig(config.nitSkill);
    lines.push('[nit "skill"]');
    lines.push(`  source = ${config.nitSkill.source}`);
    if (config.nitSkill.url) {
      lines.push(`  url = ${config.nitSkill.url}`);
    }
    lines.push('');
  }

  if (config.runtime) {
    validateRuntimeField(config.runtime.provider, 'runtime.provider');
    validateRuntimeField(config.runtime.model, 'runtime.model');
    validateRuntimeField(config.runtime.harness, 'runtime.harness');
    if (!PROVIDER_RE.test(config.runtime.provider)) {
      throw new Error('runtime.provider must contain only lowercase letters, digits, and hyphens');
    }
    if (!Number.isFinite(config.runtime.declared_at)) {
      throw new Error('runtime.declared_at must be a finite number');
    }
    lines.push('[runtime]');
    lines.push(`  provider = ${config.runtime.provider}`);
    lines.push(`  model = ${config.runtime.model}`);
    lines.push(`  harness = ${config.runtime.harness}`);
    lines.push(`  declared_at = ${config.runtime.declared_at}`);
    lines.push('');
  }

  return lines.join('\n');
}
