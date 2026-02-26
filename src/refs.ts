// ---------------------------------------------------------------------------
// nit — Branch and HEAD reference management
//
// .nit/HEAD                          → "ref: refs/heads/main"
// .nit/refs/heads/<branch>           → "<commit-hash>"
// .nit/refs/remote/<remote>/<branch> → "<commit-hash>"
// ---------------------------------------------------------------------------

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { NitBranch, NitHead } from './types.js';

/**
 * Parse the HEAD file and return its contents.
 * HEAD is always a symbolic ref (e.g. "ref: refs/heads/main").
 */
export async function getHead(nitDir: string): Promise<NitHead> {
  const headPath = join(nitDir, 'HEAD');
  const content = (await fs.readFile(headPath, 'utf-8')).trim();

  if (!content.startsWith('ref: ')) {
    throw new Error(
      `HEAD is in an unexpected state: "${content}". Only symbolic refs are supported.`,
    );
  }

  return { type: 'ref', ref: content.slice(5) };
}

/**
 * Follow HEAD to its target commit hash.
 * Resolves the symbolic ref chain: HEAD → refs/heads/main → commit hash.
 */
export async function resolveHead(nitDir: string): Promise<string> {
  const head = await getHead(nitDir);
  const refPath = join(nitDir, head.ref);
  try {
    return (await fs.readFile(refPath, 'utf-8')).trim();
  } catch {
    throw new Error(
      `Branch ref ${head.ref} does not exist. Repository may be empty.`,
    );
  }
}

/**
 * Return the current branch name (e.g. "main", "faam.io").
 */
export async function getCurrentBranch(nitDir: string): Promise<string> {
  const head = await getHead(nitDir);
  // head.ref is "refs/heads/<branch>"
  const prefix = 'refs/heads/';
  if (!head.ref.startsWith(prefix)) {
    throw new Error(`HEAD ref has unexpected format: ${head.ref}`);
  }
  return head.ref.slice(prefix.length);
}

/**
 * Set (or create) a branch ref to point at the given commit hash.
 */
export async function setBranch(
  nitDir: string,
  branch: string,
  commitHash: string,
): Promise<void> {
  const refPath = join(nitDir, 'refs', 'heads', branch);
  await fs.mkdir(join(nitDir, 'refs', 'heads'), { recursive: true });
  await fs.writeFile(refPath, commitHash + '\n', 'utf-8');
}

/**
 * Get the commit hash a branch points to, or null if the branch does not exist.
 */
export async function getBranch(
  nitDir: string,
  branch: string,
): Promise<string | null> {
  const refPath = join(nitDir, 'refs', 'heads', branch);
  try {
    return (await fs.readFile(refPath, 'utf-8')).trim();
  } catch {
    return null;
  }
}

/**
 * List all local branches with their commit hashes.
 */
export async function listBranches(nitDir: string): Promise<NitBranch[]> {
  const headsDir = join(nitDir, 'refs', 'heads');
  const branches: NitBranch[] = [];

  try {
    const entries = await fs.readdir(headsDir);
    for (const name of entries) {
      const refPath = join(headsDir, name);
      const stat = await fs.stat(refPath);
      if (stat.isFile()) {
        const commitHash = (await fs.readFile(refPath, 'utf-8')).trim();
        branches.push({ name, commitHash });
      }
    }
  } catch {
    // refs/heads/ may not exist yet
  }

  return branches.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Point HEAD at the given branch (symbolic ref).
 */
export async function setHead(nitDir: string, branch: string): Promise<void> {
  const headPath = join(nitDir, 'HEAD');
  await fs.writeFile(headPath, `ref: refs/heads/${branch}\n`, 'utf-8');
}

/**
 * Set a remote-tracking ref.
 */
export async function setRemoteRef(
  nitDir: string,
  remote: string,
  branch: string,
  commitHash: string,
): Promise<void> {
  const dir = join(nitDir, 'refs', 'remote', remote);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, branch), commitHash + '\n', 'utf-8');
}

/**
 * Get a remote-tracking ref, or null if it does not exist.
 */
export async function getRemoteRef(
  nitDir: string,
  remote: string,
  branch: string,
): Promise<string | null> {
  const refPath = join(nitDir, 'refs', 'remote', remote, branch);
  try {
    return (await fs.readFile(refPath, 'utf-8')).trim();
  } catch {
    return null;
  }
}
