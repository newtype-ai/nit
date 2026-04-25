// ---------------------------------------------------------------------------
// nit — Branch and HEAD reference management
//
// .nit/HEAD                          → "ref: refs/heads/main"
// .nit/refs/heads/<branch>           → "<commit-hash>"
// .nit/refs/remote/<remote>/<branch> → "<commit-hash>"
// ---------------------------------------------------------------------------

import { promises as fs } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { NitBranch, NitHead } from './types.js';
import { validateBranchName, validateObjectHash, validateRemoteName } from './validation.js';

function assertInside(baseDir: string, targetPath: string): void {
  const rel = relative(baseDir, targetPath);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Ref path escapes ${baseDir}`);
  }
}

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}

function headsDir(nitDir: string): string {
  return resolve(nitDir, 'refs', 'heads');
}

function branchRefPath(nitDir: string, branch: string): string {
  validateBranchName(branch);
  const base = headsDir(nitDir);
  const file = resolve(base, branch);
  assertInside(base, file);
  return file;
}

function remoteRefDir(nitDir: string, remote: string): string {
  validateRemoteName(remote);
  const base = resolve(nitDir, 'refs', 'remote');
  const dir = resolve(base, remote);
  assertInside(base, dir);
  return dir;
}

function remoteRefPath(nitDir: string, remote: string, branch: string): string {
  validateBranchName(branch);
  const base = remoteRefDir(nitDir, remote);
  const file = resolve(base, branch);
  assertInside(base, file);
  return file;
}

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
  const prefix = 'refs/heads/';
  if (!head.ref.startsWith(prefix)) {
    throw new Error(`HEAD ref has unexpected format: ${head.ref}`);
  }
  const refPath = branchRefPath(nitDir, head.ref.slice(prefix.length));
  let hash: string;
  try {
    hash = (await fs.readFile(refPath, 'utf-8')).trim();
  } catch (err) {
    if (!isNotFound(err)) throw err;
    throw new Error(
      `Branch ref ${head.ref} does not exist. Workspace may be empty.`,
    );
  }
  validateObjectHash(hash, `Branch ref ${head.ref}`);
  return hash;
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
  const branch = head.ref.slice(prefix.length);
  validateBranchName(branch);
  return branch;
}

/**
 * Set (or create) a branch ref to point at the given commit hash.
 */
export async function setBranch(
  nitDir: string,
  branch: string,
  commitHash: string,
): Promise<void> {
  validateObjectHash(commitHash, 'Commit hash');
  const refPath = branchRefPath(nitDir, branch);
  await fs.mkdir(headsDir(nitDir), { recursive: true });
  await fs.writeFile(refPath, commitHash + '\n', 'utf-8');
}

/**
 * Get the commit hash a branch points to, or null if the branch does not exist.
 */
export async function getBranch(
  nitDir: string,
  branch: string,
): Promise<string | null> {
  const refPath = branchRefPath(nitDir, branch);
  let hash: string;
  try {
    hash = (await fs.readFile(refPath, 'utf-8')).trim();
  } catch (err) {
    if (!isNotFound(err)) throw err;
    return null;
  }
  validateObjectHash(hash, `Branch "${branch}"`);
  return hash;
}

/**
 * List all local branches with their commit hashes.
 */
export async function listBranches(nitDir: string): Promise<NitBranch[]> {
  const refsDir = headsDir(nitDir);
  const branches: NitBranch[] = [];
  let entries: string[];

  try {
    entries = await fs.readdir(refsDir);
  } catch (err) {
    if (!isNotFound(err)) throw err;
    // refs/heads/ may not exist yet
    return branches;
  }

  for (const name of entries) {
    try {
      validateBranchName(name);
    } catch {
      continue;
    }
    const refPath = branchRefPath(nitDir, name);
    let stat;
    try {
      stat = await fs.stat(refPath);
    } catch (err) {
      if (!isNotFound(err)) throw err;
      continue;
    }
    if (stat.isFile()) {
      const commitHash = (await fs.readFile(refPath, 'utf-8')).trim();
      validateObjectHash(commitHash, `Branch "${name}"`);
      branches.push({ name, commitHash });
    }
  }

  return branches.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Delete a local branch ref.
 */
export async function deleteBranch(nitDir: string, branch: string): Promise<void> {
  const refPath = branchRefPath(nitDir, branch);
  await fs.unlink(refPath);
}

/**
 * Delete a remote-tracking ref.
 */
export async function deleteRemoteRef(
  nitDir: string,
  remote: string,
  branch: string,
): Promise<void> {
  const refPath = remoteRefPath(nitDir, remote, branch);
  try {
    await fs.unlink(refPath);
  } catch (err) {
    if (!isNotFound(err)) throw err;
    // May not exist
  }
}

/**
 * Point HEAD at the given branch (symbolic ref).
 */
export async function setHead(nitDir: string, branch: string): Promise<void> {
  validateBranchName(branch);
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
  validateObjectHash(commitHash, 'Commit hash');
  const dir = remoteRefDir(nitDir, remote);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(remoteRefPath(nitDir, remote, branch), commitHash + '\n', 'utf-8');
}

/**
 * Get a remote-tracking ref, or null if it does not exist.
 */
export async function getRemoteRef(
  nitDir: string,
  remote: string,
  branch: string,
): Promise<string | null> {
  const refPath = remoteRefPath(nitDir, remote, branch);
  let hash: string;
  try {
    hash = (await fs.readFile(refPath, 'utf-8')).trim();
  } catch (err) {
    if (!isNotFound(err)) throw err;
    return null;
  }
  validateObjectHash(hash, `Remote ref ${remote}/${branch}`);
  return hash;
}
