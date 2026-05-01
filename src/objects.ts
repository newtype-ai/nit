// ---------------------------------------------------------------------------
// nit — Content-addressable object store
// Objects are stored at .nit/objects/{first2chars}/{remaining}
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { NitCommit } from './types.js';
import { validateObjectHash } from './validation.js';

function assertHeaderValue(value: string, label: string): void {
  if (value.length === 0) {
    throw new Error(`${label} cannot be empty`);
  }
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${label} must not contain control characters`);
  }
}

function assertCommitMessage(message: string): void {
  if (message.includes('\0')) {
    throw new Error('Commit message must not contain NUL bytes');
  }
}

/**
 * Compute a SHA-256 hash for an object without writing it to disk.
 *
 * Hash format: SHA-256("{type} {byteLength}\0{content}")
 * This mirrors git's object hashing scheme.
 */
export function hashObject(type: 'card' | 'commit', content: string): string {
  const buf = Buffer.from(content, 'utf-8');
  const header = `${type} ${buf.byteLength}\0`;
  const hash = createHash('sha256');
  hash.update(header);
  hash.update(buf);
  return hash.digest('hex');
}

/**
 * Compute hash and persist the object to .nit/objects/.
 * Returns the hex hash. Skips write if object already exists.
 */
export async function writeObject(
  nitDir: string,
  type: 'card' | 'commit',
  content: string,
): Promise<string> {
  const hex = hashObject(type, content);
  const dir = join(nitDir, 'objects', hex.slice(0, 2));
  const file = join(dir, hex.slice(2));

  // Skip if already stored (content-addressable → idempotent)
  try {
    const existing = await fs.readFile(file, 'utf-8');
    if (hashObject(type, existing) === hex) {
      return hex;
    }
  } catch {
    // Does not exist yet — write it
  }

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, content, 'utf-8');
  return hex;
}

/**
 * Read the raw content of an object by its hash.
 */
export async function readObject(nitDir: string, hash: string): Promise<string> {
  validateObjectHash(hash);
  const file = join(nitDir, 'objects', hash.slice(0, 2), hash.slice(2));
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch {
    throw new Error(`Object not found: ${hash}`);
  }
  if (hashObject('card', raw) !== hash && hashObject('commit', raw) !== hash) {
    throw new Error(`Object hash mismatch: ${hash}`);
  }
  return raw;
}

/**
 * Check whether an object exists in the store.
 */
export async function objectExists(nitDir: string, hash: string): Promise<boolean> {
  validateObjectHash(hash);
  const file = join(nitDir, 'objects', hash.slice(0, 2), hash.slice(2));
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Serialize a commit to the text format stored on disk.
 *
 * Format:
 *   card <card-hash>
 *   parent <parent-hash>     (omitted for initial commit)
 *   author <author> <timestamp>
 *
 *   <message>
 */
export function serializeCommit(
  commit: Omit<NitCommit, 'type' | 'hash'>,
): string {
  validateObjectHash(commit.card, 'Commit card hash');
  if (commit.parent !== null) {
    validateObjectHash(commit.parent, 'Commit parent hash');
  }
  assertHeaderValue(commit.author, 'Commit author');
  if (!Number.isSafeInteger(commit.timestamp) || commit.timestamp < 0) {
    throw new Error('Commit timestamp must be a non-negative safe integer');
  }
  assertCommitMessage(commit.message);

  const lines: string[] = [];
  lines.push(`card ${commit.card}`);
  if (commit.parent !== null) {
    lines.push(`parent ${commit.parent}`);
  }
  lines.push(`author ${commit.author} ${commit.timestamp}`);
  lines.push('');
  lines.push(commit.message);
  return lines.join('\n');
}

/**
 * Parse the raw text of a commit object back into a NitCommit.
 */
export function parseCommit(hash: string, raw: string): NitCommit {
  validateObjectHash(hash, 'Commit hash');
  const lines = raw.split('\n');
  let card = '';
  let parent: string | null = null;
  let author = '';
  let timestamp = 0;
  let messageStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line === '') {
      // Everything after the blank line is the message
      messageStart = i + 1;
      break;
    }

    if (line.startsWith('card ')) {
      card = line.slice(5);
    } else if (line.startsWith('parent ')) {
      parent = line.slice(7);
    } else if (line.startsWith('author ')) {
      const authorPart = line.slice(7);
      const lastSpace = authorPart.lastIndexOf(' ');
      if (lastSpace <= 0) {
        throw new Error(`Malformed commit object ${hash}: invalid author line`);
      }
      author = authorPart.slice(0, lastSpace);
      const timestampRaw = authorPart.slice(lastSpace + 1);
      if (!/^\d+$/.test(timestampRaw)) {
        throw new Error(`Malformed commit object ${hash}: invalid timestamp`);
      }
      timestamp = Number(timestampRaw);
    } else {
      throw new Error(`Malformed commit object ${hash}: unknown header "${line}"`);
    }
  }

  if (!card) {
    throw new Error(`Malformed commit object ${hash}: missing card hash`);
  }
  validateObjectHash(card, `Malformed commit object ${hash}: card hash`);
  if (parent !== null) {
    validateObjectHash(parent, `Malformed commit object ${hash}: parent hash`);
  }
  if (!author) {
    throw new Error(`Malformed commit object ${hash}: missing author`);
  }
  assertHeaderValue(author, `Malformed commit object ${hash}: author`);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error(`Malformed commit object ${hash}: invalid timestamp`);
  }

  const message =
    messageStart >= 0 ? lines.slice(messageStart).join('\n') : '';
  assertCommitMessage(message);

  return {
    type: 'commit',
    hash,
    card,
    parent,
    author,
    timestamp,
    message,
  };
}
