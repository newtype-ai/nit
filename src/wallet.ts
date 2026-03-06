// ---------------------------------------------------------------------------
// nit — Multi-chain wallet address derivation
//
// Derives blockchain addresses from the Ed25519 identity keypair.
// No blockchain SDKs — just math and hashing.
//
// Supported chains:
//   Solana    — base58(ed25519_pubkey)
//   EVM       — keccak256(secp256k1_pubkey)[last 20 bytes]
//              (Ethereum, BSC, Polygon, Arbitrum, Avalanche, etc.)
//
// secp256k1 derivation:
//   HMAC-SHA512("secp256k1", ed25519_seed)[0:32] → deterministic private key
//   No master seed needed — the Ed25519 seed is the root of trust.
// ---------------------------------------------------------------------------

import { createHmac, createECDH } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { loadPublicKey } from './identity.js';

// ---------------------------------------------------------------------------
// Base58 encoding (Bitcoin/Solana alphabet)
// ---------------------------------------------------------------------------

const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(bytes: Uint8Array): string {
  // Count leading zeros
  let leadingZeros = 0;
  for (const byte of bytes) {
    if (byte === 0) leadingZeros++;
    else break;
  }

  // Convert to big integer
  let num = 0n;
  for (const byte of bytes) {
    num = num * 256n + BigInt(byte);
  }

  // Encode
  let encoded = '';
  while (num > 0n) {
    encoded = BASE58_ALPHABET[Number(num % 58n)] + encoded;
    num = num / 58n;
  }

  // Preserve leading zeros as '1's
  return BASE58_ALPHABET[0].repeat(leadingZeros) + encoded;
}

// ---------------------------------------------------------------------------
// secp256k1 key derivation from Ed25519 seed
// ---------------------------------------------------------------------------

/**
 * Derive a secp256k1 private key from the Ed25519 seed.
 * Uses HMAC-SHA512 with domain separator for cryptographic independence.
 */
function deriveSecp256k1Seed(ed25519Seed: Buffer): Buffer {
  const hmac = createHmac('sha512', 'secp256k1');
  hmac.update(ed25519Seed);
  return hmac.digest().subarray(0, 32);
}

/**
 * Get the uncompressed secp256k1 public key (65 bytes: 0x04 || X || Y)
 * from a 32-byte private key.
 */
function getSecp256k1PublicKey(privateKey: Buffer): Buffer {
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(privateKey);
  return Buffer.from(ecdh.getPublicKey());
}

// ---------------------------------------------------------------------------
// EVM address derivation (Ethereum, BSC, Polygon, etc.)
// ---------------------------------------------------------------------------

/**
 * Derive an EVM address from a secp256k1 public key.
 * Address = "0x" + keccak256(uncompressed_pubkey_without_prefix)[last 20 bytes]
 */
function evmAddressFromPublicKey(uncompressedPubKey: Buffer): string {
  // Remove the 0x04 prefix → 64 bytes
  const pubKeyBody = uncompressedPubKey.subarray(1);
  const hash = keccak_256(pubKeyBody);
  const addressBytes = hash.slice(hash.length - 20);
  return '0x' + Buffer.from(addressBytes).toString('hex');
}

/**
 * Apply EIP-55 mixed-case checksum encoding to an EVM address.
 */
function checksumAddress(address: string): string {
  const addr = address.slice(2).toLowerCase();
  const hash = Buffer.from(keccak_256(Buffer.from(addr, 'utf-8'))).toString(
    'hex',
  );

  let checksummed = '0x';
  for (let i = 0; i < addr.length; i++) {
    checksummed +=
      parseInt(hash[i], 16) >= 8 ? addr[i].toUpperCase() : addr[i];
  }
  return checksummed;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface WalletAddresses {
  solana: string;
  ethereum: string;
}

/**
 * Get the Solana wallet address (base58-encoded Ed25519 public key).
 */
export async function getSolanaAddress(nitDir: string): Promise<string> {
  const pubBase64 = await loadPublicKey(nitDir);
  const pubBytes = Buffer.from(pubBase64, 'base64');
  return base58Encode(pubBytes);
}

/**
 * Get the EVM wallet address (Ethereum, BSC, Polygon, etc.).
 * Derives a secp256k1 key from the Ed25519 seed, then computes keccak256.
 * Returns EIP-55 checksummed address.
 */
export async function getEvmAddress(nitDir: string): Promise<string> {
  const keyPath = join(nitDir, 'identity', 'agent.key');
  const privBase64 = (await fs.readFile(keyPath, 'utf-8')).trim();
  const ed25519Seed = Buffer.from(privBase64, 'base64');

  const secp256k1PrivKey = deriveSecp256k1Seed(ed25519Seed);
  const secp256k1PubKey = getSecp256k1PublicKey(secp256k1PrivKey);
  const rawAddress = evmAddressFromPublicKey(secp256k1PubKey);
  return checksumAddress(rawAddress);
}

/**
 * Get wallet addresses for all supported chains.
 */
export async function getWalletAddresses(
  nitDir: string,
): Promise<WalletAddresses> {
  const [solana, ethereum] = await Promise.all([
    getSolanaAddress(nitDir),
    getEvmAddress(nitDir),
  ]);
  return { solana, ethereum };
}

/**
 * Load the secp256k1 keypair as raw bytes (64-byte Uint8Array).
 * Format: [32-byte private key || 32-byte compressed public key (X only)]
 * For EVM transaction signing.
 */
export async function loadSecp256k1RawKeyPair(
  nitDir: string,
): Promise<Uint8Array> {
  const keyPath = join(nitDir, 'identity', 'agent.key');
  const privBase64 = (await fs.readFile(keyPath, 'utf-8')).trim();
  const ed25519Seed = Buffer.from(privBase64, 'base64');

  const secp256k1PrivKey = deriveSecp256k1Seed(ed25519Seed);
  const secp256k1PubKey = getSecp256k1PublicKey(secp256k1PrivKey);

  // Return [32-byte privkey || 32-byte pubkey X coordinate]
  const keypair = new Uint8Array(64);
  keypair.set(secp256k1PrivKey, 0);
  keypair.set(secp256k1PubKey.subarray(1, 33), 32); // X coordinate only
  return keypair;
}
