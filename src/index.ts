// ---------------------------------------------------------------------------
// nit — Public API
//
// Version control for agent cards.
// All operations work on the .nit/ directory at the project root.
// ---------------------------------------------------------------------------

import { promises as fs, statSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import type {
  AgentCard,
  NitCommit,
  NitBranch,
  DiffResult,
  PushResult,
  StatusResult,
} from './types.js';
import {
  hashObject,
  writeObject,
  readObject,
  serializeCommit,
  parseCommit,
} from './objects.js';
import {
  getHead,
  resolveHead,
  getCurrentBranch,
  setBranch,
  getBranch,
  listBranches as listAllBranches,
  setHead,
  setRemoteRef,
  getRemoteRef,
} from './refs.js';
import {
  generateKeypair,
  loadPublicKey,
  formatPublicKeyField,
} from './identity.js';
import { getRemoteCredential } from './config.js';
import { discoverSkills, resolveSkillPointers } from './skills.js';
import { diffCards } from './diff.js';
import {
  pushBranch as remotePushBranch,
  pushAll as remotePushAll,
} from './remote.js';

// Re-export types for consumers
export type {
  AgentCard,
  AgentCardSkill,
  NitCommit,
  NitBranch,
  NitHead,
  NitConfig,
  NitRemoteConfig,
  DiffResult,
  FieldDiff,
  PushResult,
  StatusResult,
  SkillMetadata,
} from './types.js';

// Re-export selected utilities
export { diffCards, formatDiff } from './diff.js';
export { signChallenge, verifySignature, formatPublicKeyField, parsePublicKeyField } from './identity.js';
export { fetchBranchCard } from './remote.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NIT_DIR = '.nit';
const CARD_FILE = 'agent-card.json';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Walk up from startDir looking for a .nit/ directory.
 * Returns the path to .nit/ or throws if not found.
 */
export function findNitDir(startDir?: string): string {
  let dir = resolve(startDir || process.cwd());

  while (true) {
    const candidate = join(dir, NIT_DIR);
    try {
      // Synchronous check — this is a startup utility
      const s = statSync(candidate);
      if (s.isDirectory()) return candidate;
    } catch {
      // Not found, try parent
    }

    const parent = resolve(dir, '..');
    if (parent === dir) {
      throw new Error(
        'Not a nit repository (or any parent directory). Run `nit init` first.',
      );
    }
    dir = parent;
  }
}

/**
 * Get project directory (parent of .nit/).
 */
function projectDir(nitDir: string): string {
  return resolve(nitDir, '..');
}

/**
 * Read the working copy of agent-card.json.
 */
async function readWorkingCard(nitDir: string): Promise<AgentCard> {
  const cardPath = join(projectDir(nitDir), CARD_FILE);
  try {
    const raw = await fs.readFile(cardPath, 'utf-8');
    return JSON.parse(raw) as AgentCard;
  } catch {
    throw new Error(`Cannot read ${CARD_FILE}. Does it exist?`);
  }
}

/**
 * Read the raw JSON string of the working card.
 */
async function readWorkingCardRaw(nitDir: string): Promise<string> {
  const cardPath = join(projectDir(nitDir), CARD_FILE);
  return fs.readFile(cardPath, 'utf-8');
}

/**
 * Write agent-card.json to disk.
 */
async function writeWorkingCard(
  nitDir: string,
  card: AgentCard,
): Promise<void> {
  const cardPath = join(projectDir(nitDir), CARD_FILE);
  await fs.writeFile(cardPath, JSON.stringify(card, null, 2) + '\n', 'utf-8');
}

/**
 * Get the card stored at a specific commit.
 */
async function getCardAtCommit(
  nitDir: string,
  commitHash: string,
): Promise<AgentCard> {
  const commitRaw = await readObject(nitDir, commitHash);
  const commit = parseCommit(commitHash, commitRaw);
  const cardRaw = await readObject(nitDir, commit.card);
  return JSON.parse(cardRaw) as AgentCard;
}

/**
 * Get the agent name for commit authorship.
 */
async function getAuthorName(nitDir: string): Promise<string> {
  try {
    const card = await readWorkingCard(nitDir);
    return card.name || basename(projectDir(nitDir));
  } catch {
    return basename(projectDir(nitDir));
  }
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

export interface InitResult {
  publicKey: string;
  cardUrl: string | null;
  skillsFound: string[];
}

/**
 * Initialize a new nit repository in the project directory.
 *
 * 1. Create .nit/ directory structure
 * 2. Generate Ed25519 keypair
 * 3. Create or update agent-card.json with publicKey
 * 4. Create initial commit on main branch
 */
export async function init(options?: {
  projectDir?: string;
}): Promise<InitResult> {
  const projDir = resolve(options?.projectDir || process.cwd());
  const nitDir = join(projDir, NIT_DIR);

  // Check if already initialized
  try {
    await fs.access(nitDir);
    throw new Error('Already initialized. .nit/ directory exists.');
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Already')) throw err;
    // Does not exist — good, proceed
  }

  // Create directory structure
  await fs.mkdir(join(nitDir, 'objects'), { recursive: true });
  await fs.mkdir(join(nitDir, 'refs', 'heads'), { recursive: true });
  await fs.mkdir(join(nitDir, 'refs', 'remote'), { recursive: true });
  await fs.mkdir(join(nitDir, 'identity'), { recursive: true });
  await fs.mkdir(join(nitDir, 'logs'), { recursive: true });

  // Generate keypair
  const { publicKey: pubBase64 } = await generateKeypair(nitDir);
  const publicKeyField = formatPublicKeyField(pubBase64);

  // Read or create agent-card.json
  const cardPath = join(projDir, CARD_FILE);
  let card: AgentCard;
  let skillsFound: string[] = [];

  try {
    const raw = await fs.readFile(cardPath, 'utf-8');
    card = JSON.parse(raw) as AgentCard;
    // Inject publicKey
    card.publicKey = publicKeyField;
    skillsFound = card.skills.map((s) => s.id);
  } catch {
    // No existing card — create one from discovered skills
    const discovered = await discoverSkills(projDir);
    skillsFound = discovered.map((s) => s.id);

    card = {
      protocolVersion: '0.3.0',
      name: basename(projDir),
      description: `AI agent working in ${basename(projDir)}`,
      version: '1.0.0',
      url: '',
      publicKey: publicKeyField,
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: discovered.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
      })),
    };
  }

  // Write agent-card.json
  await writeWorkingCard(nitDir, card);

  // Create initial commit
  const cardJson = JSON.stringify(card, null, 2);
  const cardHash = await writeObject(nitDir, 'card', cardJson);

  const commitContent = serializeCommit({
    card: cardHash,
    parent: null,
    author: card.name,
    timestamp: Math.floor(Date.now() / 1000),
    message: 'Initial commit',
  });
  const commitHash = await writeObject(nitDir, 'commit', commitContent);

  // Set up refs
  await setBranch(nitDir, 'main', commitHash);
  await setHead(nitDir, 'main');

  // Write empty logs/HEAD
  await fs.writeFile(join(nitDir, 'logs', 'HEAD'), '', 'utf-8');

  // Write empty config
  await fs.writeFile(join(nitDir, 'config'), '', 'utf-8');

  return {
    publicKey: publicKeyField,
    cardUrl: card.url || null,
    skillsFound,
  };
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

/**
 * Show current branch, uncommitted changes, and ahead/behind remote.
 */
export async function status(options?: {
  projectDir?: string;
}): Promise<StatusResult> {
  const nitDir = findNitDir(options?.projectDir);
  const currentBranch = await getCurrentBranch(nitDir);
  const pubBase64 = await loadPublicKey(nitDir);
  const publicKey = formatPublicKeyField(pubBase64);

  // Check uncommitted changes
  let uncommittedChanges: DiffResult | null = null;
  try {
    const headHash = await resolveHead(nitDir);
    const headCard = await getCardAtCommit(nitDir, headHash);
    const workingCard = await readWorkingCard(nitDir);
    const d = diffCards(headCard, workingCard);
    if (d.changed) {
      uncommittedChanges = d;
    }
  } catch {
    // May fail on empty repo
  }

  // Per-branch ahead/behind
  const branches = await listAllBranches(nitDir);
  const branchStatus: StatusResult['branches'] = [];

  for (const b of branches) {
    const remoteHash = await getRemoteRef(nitDir, 'origin', b.name);
    let ahead = 0;

    if (remoteHash && remoteHash !== b.commitHash) {
      // Count commits ahead of remote
      let hash: string | null = b.commitHash;
      while (hash && hash !== remoteHash) {
        ahead++;
        try {
          const raw = await readObject(nitDir, hash);
          const c = parseCommit(hash, raw);
          hash = c.parent;
        } catch {
          break;
        }
      }
    } else if (!remoteHash) {
      // Never pushed — count all commits
      let hash: string | null = b.commitHash;
      while (hash) {
        ahead++;
        try {
          const raw = await readObject(nitDir, hash);
          const c = parseCommit(hash, raw);
          hash = c.parent;
        } catch {
          break;
        }
      }
    }

    branchStatus.push({ name: b.name, ahead, behind: 0 });
  }

  return {
    branch: currentBranch,
    publicKey,
    uncommittedChanges,
    branches: branchStatus,
  };
}

// ---------------------------------------------------------------------------
// commit
// ---------------------------------------------------------------------------

/**
 * Snapshot the current agent-card.json as a new commit.
 * Resolves skill pointers from SKILL.md before committing.
 */
export async function commit(
  message: string,
  options?: { projectDir?: string },
): Promise<NitCommit> {
  const nitDir = findNitDir(options?.projectDir);
  const projDir = projectDir(nitDir);

  // Read and resolve skills
  let card = await readWorkingCard(nitDir);
  card = await resolveSkillPointers(card, projDir);

  // Write the resolved card back (skill names/descriptions may have updated)
  await writeWorkingCard(nitDir, card);

  const cardJson = JSON.stringify(card, null, 2);
  const cardHash = await writeObject(nitDir, 'card', cardJson);

  // Check if anything changed vs HEAD
  const currentBranch = await getCurrentBranch(nitDir);
  const parentHash = await getBranch(nitDir, currentBranch);

  if (parentHash) {
    const parentRaw = await readObject(nitDir, parentHash);
    const parentCommit = parseCommit(parentHash, parentRaw);
    if (parentCommit.card === cardHash) {
      throw new Error('Nothing to commit — agent card is unchanged.');
    }
  }

  // Create commit
  const author = await getAuthorName(nitDir);
  const commitContent = serializeCommit({
    card: cardHash,
    parent: parentHash,
    author,
    timestamp: Math.floor(Date.now() / 1000),
    message,
  });
  const commitHash = await writeObject(nitDir, 'commit', commitContent);

  // Update branch ref
  await setBranch(nitDir, currentBranch, commitHash);

  return {
    type: 'commit',
    hash: commitHash,
    card: cardHash,
    parent: parentHash,
    author,
    timestamp: Math.floor(Date.now() / 1000),
    message,
  };
}

// ---------------------------------------------------------------------------
// log
// ---------------------------------------------------------------------------

/**
 * Walk the commit chain from the current branch HEAD.
 */
export async function log(options?: {
  projectDir?: string;
  count?: number;
}): Promise<NitCommit[]> {
  const nitDir = findNitDir(options?.projectDir);
  const currentBranch = await getCurrentBranch(nitDir);
  let hash: string | null = await getBranch(nitDir, currentBranch);

  const commits: NitCommit[] = [];
  const limit = options?.count ?? 50;

  while (hash && commits.length < limit) {
    const raw = await readObject(nitDir, hash);
    const c = parseCommit(hash, raw);
    commits.push(c);
    hash = c.parent;
  }

  return commits;
}

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

/**
 * Compare the current card against a target.
 *
 * - No target: working card vs HEAD
 * - Branch name: HEAD vs target branch HEAD
 * - Commit hash (64 hex chars): HEAD vs specific commit
 */
export async function diff(
  target?: string,
  options?: { projectDir?: string },
): Promise<DiffResult> {
  const nitDir = findNitDir(options?.projectDir);

  if (!target) {
    // Working card vs HEAD
    const headHash = await resolveHead(nitDir);
    const headCard = await getCardAtCommit(nitDir, headHash);
    const workingCard = await readWorkingCard(nitDir);
    return diffCards(headCard, workingCard);
  }

  // Check if target is a branch name
  const targetBranchHash = await getBranch(nitDir, target);
  const headHash = await resolveHead(nitDir);
  const headCard = await getCardAtCommit(nitDir, headHash);

  if (targetBranchHash) {
    const targetCard = await getCardAtCommit(nitDir, targetBranchHash);
    return diffCards(headCard, targetCard);
  }

  // Assume it's a commit hash
  if (/^[0-9a-f]{64}$/.test(target)) {
    const targetCard = await getCardAtCommit(nitDir, target);
    return diffCards(headCard, targetCard);
  }

  throw new Error(
    `Unknown target "${target}". Provide a branch name or commit hash.`,
  );
}

// ---------------------------------------------------------------------------
// branch
// ---------------------------------------------------------------------------

/**
 * List branches (no name) or create a new branch (with name).
 */
export async function branch(
  name?: string,
  options?: { projectDir?: string },
): Promise<NitBranch[]> {
  const nitDir = findNitDir(options?.projectDir);

  if (name) {
    // Create new branch from HEAD
    const existing = await getBranch(nitDir, name);
    if (existing) {
      throw new Error(`Branch "${name}" already exists.`);
    }

    const headHash = await resolveHead(nitDir);
    await setBranch(nitDir, name, headHash);
  }

  return listAllBranches(nitDir);
}

// ---------------------------------------------------------------------------
// checkout
// ---------------------------------------------------------------------------

/**
 * Switch to a different branch. Overwrites agent-card.json with the
 * branch's version. Aborts if there are uncommitted changes.
 */
export async function checkout(
  branchName: string,
  options?: { projectDir?: string },
): Promise<void> {
  const nitDir = findNitDir(options?.projectDir);

  // Check for uncommitted changes
  try {
    const headHash = await resolveHead(nitDir);
    const headCard = await getCardAtCommit(nitDir, headHash);
    const workingCard = await readWorkingCard(nitDir);
    const d = diffCards(headCard, workingCard);
    if (d.changed) {
      throw new Error(
        'You have uncommitted changes. Commit or discard them before switching branches.',
      );
    }
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes('uncommitted changes')
    ) {
      throw err;
    }
    // Other errors (empty repo, etc.) — proceed
  }

  // Resolve target branch
  const targetHash = await getBranch(nitDir, branchName);
  if (!targetHash) {
    throw new Error(`Branch "${branchName}" does not exist.`);
  }

  // Read card at target commit and write to working copy
  const targetCard = await getCardAtCommit(nitDir, targetHash);
  await writeWorkingCard(nitDir, targetCard);

  // Update HEAD
  await setHead(nitDir, branchName);
}

// ---------------------------------------------------------------------------
// push
// ---------------------------------------------------------------------------

/**
 * Push current branch (or all branches) to the remote.
 */
export async function push(options?: {
  projectDir?: string;
  remoteName?: string;
  all?: boolean;
}): Promise<PushResult[]> {
  const nitDir = findNitDir(options?.projectDir);
  const remoteName = options?.remoteName || 'origin';
  const branches = await listAllBranches(nitDir);
  const currentBranch = await getCurrentBranch(nitDir);

  const toPush = options?.all
    ? branches
    : branches.filter((b) => b.name === currentBranch);

  if (toPush.length === 0) {
    throw new Error('No branches to push.');
  }

  const results: PushResult[] = [];

  for (const b of toPush) {
    // Read the card at this branch's commit
    const commitRaw = await readObject(nitDir, b.commitHash);
    const c = parseCommit(b.commitHash, commitRaw);
    const cardJson = await readObject(nitDir, c.card);

    const result = await remotePushBranch(
      nitDir,
      remoteName,
      b.name,
      cardJson,
      b.commitHash,
    );

    if (result.success) {
      // Update remote-tracking ref
      await setRemoteRef(nitDir, remoteName, b.name, b.commitHash);
    }

    results.push(result);
  }

  return results;
}

// ---------------------------------------------------------------------------
// remote
// ---------------------------------------------------------------------------

export interface RemoteInfo {
  name: string;
  url: string;
  hasCredential: boolean;
}

/**
 * Show remote info. URL comes from agent-card.json, credential from .nit/config.
 */
export async function remote(options?: {
  projectDir?: string;
}): Promise<RemoteInfo> {
  const nitDir = findNitDir(options?.projectDir);
  const card = await readWorkingCard(nitDir);
  const credential = await getRemoteCredential(nitDir, 'origin');

  return {
    name: 'origin',
    url: card.url || '(not set)',
    hasCredential: credential !== null,
  };
}
