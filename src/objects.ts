// ---------------------------------------------------------------------------
// nit — Content-addressable object store
// Objects are stored at .nit/objects/{first2chars}/{remaining}
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { NitCommit } from './types.js';

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
    await fs.access(file);
    return hex;
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
  const file = join(nitDir, 'objects', hash.slice(0, 2), hash.slice(2));
  try {
    return await fs.readFile(file, 'utf-8');
  } catch {
    throw new Error(`Object not found: ${hash}`);
  }
}

/**
 * Check whether an object exists in the store.
 */
export async function objectExists(nitDir: string, hash: string): Promise<boolean> {
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
      author = authorPart.slice(0, lastSpace);
      timestamp = parseInt(authorPart.slice(lastSpace + 1), 10);
    }
  }

  if (!card) {
    throw new Error(`Malformed commit object ${hash}: missing card hash`);
  }

  const message =
    messageStart >= 0 ? lines.slice(messageStart).join('\n') : '';

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
