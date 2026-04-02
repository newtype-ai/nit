// ---------------------------------------------------------------------------
// nit — Machine fingerprint for identity metadata
//
// Computes a privacy-preserving machine hash from platform-specific identifiers.
// Stored locally at .nit/identity/machine-hash and sent to the server during
// TOFU registration. The server never sees the raw machine ID — only the hash.
//
// The machine hash is one of several signals the server collects for anti-sybil.
// No single signal is sufficient; combined signals provide insights over time.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { platform, hostname, arch, cpus } from 'node:os';

// ---------------------------------------------------------------------------
// Machine ID retrieval (platform-specific)
// ---------------------------------------------------------------------------

/**
 * Get the platform-specific machine identifier.
 *
 * - macOS: IOPlatformUUID (hardware-bound, survives OS reinstalls)
 * - Linux: /etc/machine-id (generated at OS install)
 * - Fallback: hostname + platform + arch + CPU model
 */
export function getMachineId(): string {
  try {
    if (platform() === 'darwin') {
      const output = execSync(
        'ioreg -rd1 -c IOPlatformExpertDevice',
        { encoding: 'utf-8', timeout: 5000 },
      );
      const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (match?.[1]) return match[1];
    }

    if (platform() === 'linux') {
      try {
        const id = require('node:fs').readFileSync('/etc/machine-id', 'utf-8').trim();
        if (id) return id;
      } catch {
        // /etc/machine-id may not exist in containers
      }
    }
  } catch {
    // Command failed — fall through to fallback
  }

  // Fallback: combine OS-level identifiers
  const cpu = cpus()[0]?.model ?? 'unknown-cpu';
  return `${hostname()}\n${platform()}\n${arch()}\n${cpu}`;
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 hash of the machine ID for privacy.
 * The server stores this hash, never the raw machine identifier.
 */
export function computeMachineHash(machineId: string): string {
  return createHash('sha256').update(machineId).digest('hex');
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Save the machine hash to .nit/identity/machine-hash.
 */
export async function saveMachineHash(
  nitDir: string,
  hash: string,
): Promise<void> {
  const filePath = join(nitDir, 'identity', 'machine-hash');
  await fs.writeFile(filePath, hash + '\n', 'utf-8');
}

/**
 * Load the machine hash from .nit/identity/machine-hash.
 * Returns null if the file doesn't exist (pre-0.6.0 identities).
 */
export async function loadMachineHash(
  nitDir: string,
): Promise<string | null> {
  const filePath = join(nitDir, 'identity', 'machine-hash');
  try {
    return (await fs.readFile(filePath, 'utf-8')).trim();
  } catch {
    return null;
  }
}
