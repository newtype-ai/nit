// ---------------------------------------------------------------------------
// nit — Transaction signing and broadcast
//
// Minimal primitives for spending from nit-derived wallets.
// The agent constructs transactions. nit only signs and broadcasts.
//
// Supported chains:
//   EVM    — ECDSA secp256k1 signing + eth_sendRawTransaction
//   Solana — Ed25519 signing + sendTransaction
// ---------------------------------------------------------------------------

import type { SignTxResult, BroadcastResult } from './types.js';
import {
  signEvmHash,
  signSolanaBytes,
  getEvmAddress,
  getSolanaAddress,
} from './wallet.js';
import { readConfig } from './config.js';

function parseHexData(data: string): Buffer {
  const hex = data.startsWith('0x') ? data.slice(2) : data;
  if (hex.length === 0) {
    throw new Error('Transaction data cannot be empty');
  }
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error('Transaction data must be valid hex');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Sign transaction data with the agent's identity-derived key.
 *
 * @param nitDir  Path to .nit/ directory
 * @param chain   'evm' or 'solana'
 * @param data    Hex string (0x-prefixed or bare).
 *                EVM: 32-byte keccak256 hash of the unsigned transaction.
 *                Solana: serialized transaction message bytes.
 */
export async function signTx(
  nitDir: string,
  chain: 'evm' | 'solana',
  data: string,
): Promise<SignTxResult> {
  const bytes = parseHexData(data);

  if (chain === 'evm') {
    const result = await signEvmHash(nitDir, bytes);
    const address = await getEvmAddress(nitDir);
    return {
      chain: 'evm',
      signature: result.signature,
      recovery: result.recovery,
      address,
    };
  }

  // Solana
  const sig = await signSolanaBytes(nitDir, bytes);
  const address = await getSolanaAddress(nitDir);
  return {
    chain: 'solana',
    signature: Buffer.from(sig).toString('base64'),
    address,
  };
}

/**
 * Broadcast a signed transaction to the configured RPC endpoint.
 *
 * @param nitDir     Path to .nit/ directory
 * @param chain      'evm' or 'solana'
 * @param signedTx   The fully-signed transaction.
 *                   EVM: hex-encoded (for eth_sendRawTransaction).
 *                   Solana: base64-encoded (for sendTransaction).
 * @param rpcUrl     Optional RPC URL override (uses config if not provided).
 */
export async function broadcast(
  nitDir: string,
  chain: 'evm' | 'solana',
  signedTx: string,
  rpcUrl?: string,
): Promise<BroadcastResult> {
  if (!rpcUrl) {
    const config = await readConfig(nitDir);
    rpcUrl = config.rpc?.[chain]?.url;
    if (!rpcUrl) {
      throw new Error(
        `No RPC endpoint configured for '${chain}'. Run: nit rpc set-url ${chain} <url>`,
      );
    }
  }

  const body =
    chain === 'evm'
      ? {
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_sendRawTransaction',
          params: [signedTx.startsWith('0x') ? signedTx : '0x' + signedTx],
        }
      : {
          jsonrpc: '2.0',
          id: 1,
          method: 'sendTransaction',
          params: [signedTx, { encoding: 'base64' }],
        };

  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`RPC request failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as {
    result?: string;
    error?: { message: string; code?: number };
  };

  if (json.error) {
    throw new Error(`RPC error: ${json.error.message}`);
  }

  if (!json.result) {
    throw new Error('RPC returned no result');
  }

  return { chain, txHash: json.result, rpcUrl };
}
