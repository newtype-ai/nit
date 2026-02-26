// ---------------------------------------------------------------------------
// nit — Ed25519 identity management
//
// Key storage:
//   .nit/identity/agent.pub   — base64 raw 32-byte public key
//   .nit/identity/agent.key   — base64 raw 32-byte private seed (0o600)
//   .nit/identity/agent-id    — derived UUID (UUIDv5 of public key)
//
// Public key format in agent-card.json: "ed25519:<base64>"
// Agent ID derivation: UUIDv5(NIT_NAMESPACE, "ed25519:<base64>")
// ---------------------------------------------------------------------------

import {
  createHash,
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// base64url <-> standard base64 conversion
// ---------------------------------------------------------------------------

function base64urlToBase64(b64url: string): string {
  let s = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4 !== 0) s += '=';
  return s;
}

function base64ToBase64url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

/**
 * Generate an Ed25519 keypair, save to .nit/identity/, and return both keys
 * as standard base64 strings (of the raw 32-byte representations).
 */
export async function generateKeypair(
  nitDir: string,
): Promise<{ publicKey: string; privateKey: string }> {
  const identityDir = join(nitDir, 'identity');
  await fs.mkdir(identityDir, { recursive: true });

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');

  // Export raw bytes via JWK
  const pubJwk = publicKey.export({ format: 'jwk' });
  const privJwk = privateKey.export({ format: 'jwk' });

  // JWK uses base64url; convert to standard base64 for file storage
  const pubBase64 = base64urlToBase64(pubJwk.x!);
  const privBase64 = base64urlToBase64(privJwk.d!);

  const pubPath = join(identityDir, 'agent.pub');
  const keyPath = join(identityDir, 'agent.key');

  await fs.writeFile(pubPath, pubBase64 + '\n', 'utf-8');
  await fs.writeFile(keyPath, privBase64 + '\n', {
    mode: 0o600,
    encoding: 'utf-8',
  });

  return { publicKey: pubBase64, privateKey: privBase64 };
}

// ---------------------------------------------------------------------------
// Key loading
// ---------------------------------------------------------------------------

/**
 * Read the public key from .nit/identity/agent.pub.
 * Returns the standard base64 string of the raw 32-byte key.
 */
export async function loadPublicKey(nitDir: string): Promise<string> {
  const pubPath = join(nitDir, 'identity', 'agent.pub');
  try {
    return (await fs.readFile(pubPath, 'utf-8')).trim();
  } catch {
    throw new Error(
      'No identity found. Run `nit init` to generate a keypair.',
    );
  }
}

/**
 * Read the private key from .nit/identity/agent.key and return a
 * Node.js KeyObject suitable for signing.
 */
export async function loadPrivateKey(nitDir: string): Promise<KeyObject> {
  const pubBase64 = await loadPublicKey(nitDir);
  const keyPath = join(nitDir, 'identity', 'agent.key');

  let privBase64: string;
  try {
    privBase64 = (await fs.readFile(keyPath, 'utf-8')).trim();
  } catch {
    throw new Error(
      'Private key not found at .nit/identity/agent.key. Regenerate with `nit init`.',
    );
  }

  // Reconstruct the private KeyObject via JWK
  const xB64url = base64ToBase64url(pubBase64);
  const dB64url = base64ToBase64url(privBase64);

  return createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: xB64url, d: dB64url },
    format: 'jwk',
  });
}

// ---------------------------------------------------------------------------
// Public key formatting
// ---------------------------------------------------------------------------

/**
 * Format a raw base64 public key as the value for the agent card's
 * `publicKey` field: "ed25519:<base64>".
 */
export function formatPublicKeyField(pubBase64: string): string {
  return `ed25519:${pubBase64}`;
}

/**
 * Extract the raw base64 key from an "ed25519:<base64>" field value.
 */
export function parsePublicKeyField(field: string): string {
  const prefix = 'ed25519:';
  if (!field.startsWith(prefix)) {
    throw new Error(
      `Invalid publicKey format: expected "ed25519:<base64>", got "${field}"`,
    );
  }
  return field.slice(prefix.length);
}

// ---------------------------------------------------------------------------
// Signing & verification
// ---------------------------------------------------------------------------

/**
 * Sign a challenge string with the agent's private key.
 * Returns a standard base64-encoded signature.
 */
export async function signChallenge(
  nitDir: string,
  challenge: string,
): Promise<string> {
  const privateKey = await loadPrivateKey(nitDir);
  const sig = sign(null, Buffer.from(challenge, 'utf-8'), privateKey);
  return sig.toString('base64');
}

/**
 * Verify a signature against a challenge using the raw base64 public key.
 * This is a utility for consumers; nit itself uses it in the remote module
 * for challenge-response flows.
 */
export function verifySignature(
  pubBase64: string,
  challenge: string,
  signatureBase64: string,
): boolean {
  const xB64url = base64ToBase64url(pubBase64);

  const publicKeyObj = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: xB64url },
    format: 'jwk',
  });

  return verify(
    null,
    Buffer.from(challenge, 'utf-8'),
    publicKeyObj,
    Buffer.from(signatureBase64, 'base64'),
  );
}

/**
 * Sign an arbitrary message with the agent's private key.
 * Returns a standard base64-encoded signature.
 */
export async function signMessage(
  nitDir: string,
  message: string,
): Promise<string> {
  const privateKey = await loadPrivateKey(nitDir);
  const sig = sign(null, Buffer.from(message, 'utf-8'), privateKey);
  return sig.toString('base64');
}

// ---------------------------------------------------------------------------
// Self-sovereign agent ID derivation
// ---------------------------------------------------------------------------

/**
 * Fixed namespace UUID for nit agent ID derivation.
 * Generated once, hardcoded forever. Changing this would change ALL agent IDs.
 * Must match the server-side constant in apps/agent-cards/src/api/agent-id.ts.
 */
export const NIT_NAMESPACE = '801ba518-f326-47e5-97c9-d1efd1865a19';

/**
 * Derive a deterministic agent ID (UUID) from an Ed25519 public key field.
 * Uses UUIDv5: SHA-1 hash of NIT_NAMESPACE + publicKeyField.
 *
 * @param publicKeyField  "ed25519:<base64>" format string
 * @returns               UUID string (lowercase, with hyphens)
 */
export function deriveAgentId(publicKeyField: string): string {
  return uuidv5(publicKeyField, NIT_NAMESPACE);
}

/**
 * Load the agent ID from .nit/identity/agent-id.
 */
export async function loadAgentId(nitDir: string): Promise<string> {
  const idPath = join(nitDir, 'identity', 'agent-id');
  try {
    return (await fs.readFile(idPath, 'utf-8')).trim();
  } catch {
    throw new Error(
      'No agent ID found. Run `nit init` to generate identity.',
    );
  }
}

/**
 * Save the agent ID to .nit/identity/agent-id.
 */
export async function saveAgentId(
  nitDir: string,
  agentId: string,
): Promise<void> {
  const idPath = join(nitDir, 'identity', 'agent-id');
  await fs.writeFile(idPath, agentId + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// UUIDv5 (SHA-1 based, Node.js implementation)
// ---------------------------------------------------------------------------

function parseUuid(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '');
  return Buffer.from(hex, 'hex');
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function uuidv5(name: string, namespace: string): string {
  const namespaceBytes = parseUuid(namespace);
  const nameBytes = Buffer.from(name, 'utf-8');

  const data = Buffer.concat([namespaceBytes, nameBytes]);
  const hash = createHash('sha1').update(data).digest();

  // Take first 16 bytes and set version (5) and variant (RFC 4122) bits
  const uuid = Buffer.from(hash.subarray(0, 16));
  uuid[6] = (uuid[6] & 0x0f) | 0x50; // version 5
  uuid[8] = (uuid[8] & 0x3f) | 0x80; // variant RFC 4122

  return formatUuid(uuid);
}
