// ---------------------------------------------------------------------------
// nit — Public API
//
// Version control for agent cards.
// All operations work on the .nit/ directory at the project root.
// ---------------------------------------------------------------------------

import { promises as fs, statSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import {
  assertAgentCardShape,
  type AgentCard,
  type AuthConfig,
  type AuthProvider,
  type NitCommit,
  type NitBranch,
  type NitRpcConfig,
  type DiffResult,
  type PushResult,
  type StatusResult,
  type WalletAddresses,
  type SignTxResult,
  type BroadcastResult,
  type AgentRuntime,
  type LoginPayload,
  type LoginVerificationResult,
  type NitSkillConfig,
  type NitSkillSource,
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
  deleteBranch as deleteLocalBranch,
  deleteRemoteRef,
} from './refs.js';
import {
  generateKeypair,
  loadPublicKey,
  formatPublicKeyField,
  deriveAgentId,
  loadAgentId,
  saveAgentId,
  signMessage,
  parsePublicKeyField,
  verifySignature,
  loadRawKeyPair,
} from './identity.js';
import {
  discoverSkills,
  discoverProjectSkills,
  discoverSkillsDir,
  resolveSkillPointers,
  createSkillTemplate,
  updateSkillAuth,
  readSkillAuth,
  createNitSkill,
  normalizeNitSkillConfig,
  DEFAULT_NIT_SKILL_URL,
  type NitSkillInstallResult,
  type NitSkillOptions,
} from './skills.js';
import { getWalletAddresses, getSolanaAddress, getEvmAddress, loadSecp256k1RawKeyPair } from './wallet.js';
import { diffCards } from './diff.js';
import {
  pushBranch as remotePushBranch,
  pushAll as remotePushAll,
  deleteRemoteBranch,
  listRemoteBranches,
} from './remote.js';
import {
  readConfig,
  writeConfig,
  getRemoteUrl,
  getSkillsDir,
  setRemoteUrl as configSetRemoteUrl,
  setRpcUrl as configSetRpcUrl,
  setRuntime as configSetRuntime,
  getRuntime as configGetRuntime,
  clearRuntime as configClearRuntime,
} from './config.js';
import { signTx as txSignTx, broadcast as txBroadcast } from './tx.js';
import { getMachineId, computeMachineHash, saveMachineHash, loadMachineHash } from './fingerprint.js';
import {
  validateBranchName,
  validateConfigValue,
  validateHttpUrl,
  validateAgentId,
  validateRemoteName,
  validateRpcChainName,
} from './validation.js';
import { fetchWithTimeout } from './http.js';

// Re-export types and runtime validators for consumers
export { assertAgentCardShape } from './types.js';
export type {
  AgentCard,
  AgentCardSkill,
  AuthConfig,
  AuthProvider,
  NitCommit,
  NitBranch,
  NitHead,
  NitConfig,
  NitRemoteConfig,
  NitRpcConfig,
  DiffResult,
  SignTxResult,
  BroadcastResult,
  FieldDiff,
  PushResult,
  StatusResult,
  LoginPayload,
  LoginVerificationResult,
  NitSkillConfig,
  NitSkillSource,
  SkillMetadata,
  WalletAddresses,
  IdentityMetadata,
  VerifyPolicy,
  ServerAttestation,
} from './types.js';

// Re-export selected utilities
export { diffCards, formatDiff } from './diff.js';
export { DEFAULT_NIT_SKILL_URL, normalizeNitSkillConfig } from './skills.js';
export type { NitSkillInstallResult, NitSkillOptions } from './skills.js';
export {
  signChallenge,
  signMessage,
  formatPublicKeyField,
  parsePublicKeyField,
  verifySignature,
  deriveAgentId,
  loadAgentId,
  loadRawKeyPair,
  NIT_NAMESPACE,
} from './identity.js';
export { fetchBranchCard } from './remote.js';
export {
  getSolanaAddress,
  getEvmAddress,
  getWalletAddresses,
  loadSecp256k1RawKeyPair,
  base58Encode,
  signEvmHash,
  signSolanaBytes,
} from './wallet.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NIT_DIR = '.nit';
const CARD_FILE = 'agent-card.json';
const DEFAULT_API_BASE = 'https://api.newtype-ai.org';
const CURRENT_PROTOCOL_VERSION = '0.3.0';
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function defaultCardUrl(agentId: string): string {
  return `https://agent-${agentId}.newtype-ai.org`;
}

function cardReadBaseUrl(apiBase: string, agentId: string): string {
  const normalized = apiBase.replace(/\/$/, '');
  if (normalized === DEFAULT_API_BASE) {
    return defaultCardUrl(agentId);
  }
  return normalized;
}

async function resolveRemoteUrl(nitDir: string, remoteName: string): Promise<string> {
  validateRemoteName(remoteName);
  const remoteUrl = await getRemoteUrl(nitDir, remoteName);
  if (remoteUrl) {
    return remoteUrl;
  }
  if (remoteName === 'origin') {
    return DEFAULT_API_BASE;
  }
  throw new Error(`Remote "${remoteName}" does not exist. Use 'nit remote add ${remoteName} <url>' to create it.`);
}

/**
 * Validate and auto-fill required agent card fields.
 * Enforces A2A-required fields. Auto-fills protocolVersion and modes if missing.
 * Throws if name or description is empty (agent must set these).
 */
function validateAndFillCard(card: AgentCard): void {
  // Auto-fill fields nit can determine
  card.protocolVersion = CURRENT_PROTOCOL_VERSION;
  if (!card.defaultInputModes?.length) card.defaultInputModes = ['text/plain'];
  if (!card.defaultOutputModes?.length) card.defaultOutputModes = ['text/plain'];
  if (!card.version) card.version = '1.0.0';
  if (!card.skills) card.skills = [];

  // Require fields the agent must provide
  if (!card.name?.trim()) {
    throw new Error('agent-card.json is missing "name". Set a name for your agent.');
  }
  validateConfigValue(card.name, 'agent-card.json name');
  if (!card.description?.trim()) {
    throw new Error('agent-card.json is missing "description". Describe what your agent does.');
  }

  assertAgentCardShape(card);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find .nit/ in the given directory (or cwd).
 * Identity is explicit — no upward directory walking.
 */
export function findNitDir(startDir?: string): string {
  const dir = resolve(startDir || process.cwd());
  const candidate = join(dir, NIT_DIR);
  try {
    const s = statSync(candidate);
    if (s.isDirectory()) return candidate;
  } catch {
    // Not found
  }
  throw new Error('Not a nit workspace. Run `nit init` first.');
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
  let raw: string;
  try {
    raw = await fs.readFile(cardPath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(`Cannot read ${CARD_FILE}. Does it exist?`);
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid ${CARD_FILE}: ${msg}`);
  }
  assertAgentCardShape(parsed);
  return parsed;
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

async function normalizeCardForLocalIdentity(
  nitDir: string,
  card: AgentCard,
  label = 'agent card',
): Promise<AgentCard> {
  const pubBase64 = await loadPublicKey(nitDir);
  const publicKey = formatPublicKeyField(pubBase64);
  const walletAddrs = await getWalletAddresses(nitDir);
  const expectedWallet = { solana: walletAddrs.solana, evm: walletAddrs.ethereum };
  const agentId = await loadAgentId(nitDir);

  if (card.publicKey && card.publicKey !== publicKey) {
    throw new Error(`${label} publicKey does not match local identity`);
  }
  if (card.wallet) {
    if (card.wallet.solana && card.wallet.solana !== expectedWallet.solana) {
      throw new Error(`${label} Solana wallet does not match local identity`);
    }
    if (card.wallet.evm && card.wallet.evm !== expectedWallet.evm) {
      throw new Error(`${label} EVM wallet does not match local identity`);
    }
  }

  const normalized: AgentCard = {
    ...card,
    publicKey,
    wallet: expectedWallet,
    url: defaultCardUrl(agentId),
  };

  const runtime = await configGetRuntime(nitDir);
  if (runtime) {
    normalized.runtime = runtime;
  } else {
    delete normalized.runtime;
  }

  validateAndFillCard(normalized);
  return normalized;
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

export interface InitResult {
  agentId: string;
  publicKey: string;
  cardUrl: string;
  walletAddresses: WalletAddresses;
  skillsFound: string[];
  skillsDir: string;
  nitSkillPath: string | null;
  nitSkillSource: NitSkillSource;
  nitSkillUrl?: string;
}

/**
 * Initialize a new nit workspace in the project directory.
 *
 * 1. Create .nit/ directory structure
 * 2. Generate Ed25519 keypair
 * 3. Create or update agent-card.json with publicKey
 * 4. Create initial commit on main branch
 */
export async function init(options?: {
  projectDir?: string;
} & NitSkillOptions): Promise<InitResult> {
  const projDir = resolve(options?.projectDir || process.cwd());
  const nitDir = join(projDir, NIT_DIR);
  const cardPath = join(projDir, CARD_FILE);

  // Check if already initialized
  try {
    await fs.access(nitDir);
    throw new Error('Already initialized. .nit/ directory exists.');
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Already')) throw err;
    // Does not exist — good, proceed
  }

  // Read an existing card before creating .nit/. Malformed files should fail
  // without silently replacing user data or leaving a half-initialized identity.
  let existingCard: AgentCard | null = null;
  let discoveredSkills: Awaited<ReturnType<typeof discoverProjectSkills>> | null = null;
  try {
    const raw = await fs.readFile(cardPath, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid ${CARD_FILE}: ${msg}`);
    }
    assertAgentCardShape(parsed);
    validateAndFillCard(parsed);
    existingCard = parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw err;
    }
    discoveredSkills = await discoverProjectSkills(projDir);
  }

  // Create directory structure
  await fs.mkdir(join(nitDir, 'objects'), { recursive: true });
  await fs.mkdir(join(nitDir, 'refs', 'heads'), { recursive: true });
  await fs.mkdir(join(nitDir, 'refs', 'remote'), { recursive: true });
  await fs.mkdir(join(nitDir, 'identity'), { recursive: true });
  await fs.mkdir(join(nitDir, 'logs'), { recursive: true });

  // Generate keypair and derive agent ID
  const { publicKey: pubBase64 } = await generateKeypair(nitDir);
  const publicKeyField = formatPublicKeyField(pubBase64);
  const agentId = deriveAgentId(publicKeyField);
  await saveAgentId(nitDir, agentId);

  // Read or create agent-card.json
  let card: AgentCard;
  let skillsFound: string[] = [];

  if (existingCard) {
    card = existingCard;
    card.publicKey = publicKeyField;
  } else {
    // No existing card — create one from discovered skills
    const discovered = discoveredSkills ?? await discoverProjectSkills(projDir);
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

  // Set card URL if not already specified
  if (!card.url) {
    card.url = defaultCardUrl(agentId);
  }

  // Inject wallet addresses
  const walletAddresses = await getWalletAddresses(nitDir);
  card.wallet = { solana: walletAddresses.solana, evm: walletAddresses.ethereum };

  validateAndFillCard(card);
  skillsFound = card.skills.map((s) => s.id);

  // Compute and store machine fingerprint
  const machineId = getMachineId();
  const machineHash = computeMachineHash(machineId);
  await saveMachineHash(nitDir, machineHash);

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

  // Discover and store skills directory
  const skillsDir = await discoverSkillsDir(projDir);

  const nitSkillConfig = normalizeNitSkillConfig(options);

  // Write default config with remote + skills dir
  await writeConfig(nitDir, {
    remotes: { origin: { url: DEFAULT_API_BASE } },
    skillsDir,
    nitSkill: nitSkillConfig,
  });

  // Place nit's own SKILL.md in the skills directory
  const nitSkill = await createNitSkill(skillsDir, {
    skillSource: nitSkillConfig.source,
    skillUrl: nitSkillConfig.url,
  });

  return {
    agentId,
    publicKey: publicKeyField,
    cardUrl: card.url,
    walletAddresses,
    skillsFound,
    skillsDir,
    nitSkillPath: nitSkill.path,
    nitSkillSource: nitSkill.source,
    nitSkillUrl: nitSkill.url,
  };
}

export interface NitSkillRefreshResult extends NitSkillInstallResult {
  skillsDir: string;
  config: NitSkillConfig;
}

/**
 * Refresh nit's own SKILL.md from the configured source.
 *
 * New workspaces default to Newtype. Older workspaces without this config are
 * treated the same way, then persisted with the default.
 */
export async function skillRefresh(
  options?: { projectDir?: string } & NitSkillOptions,
): Promise<NitSkillRefreshResult> {
  const nitDir = findNitDir(options?.projectDir);
  const projDir = projectDir(nitDir);
  const currentConfig = await readConfig(nitDir);
  const hasOverride = options?.skillSource !== undefined || options?.skillUrl !== undefined;
  const nitSkillConfig = hasOverride
    ? normalizeNitSkillConfig(options)
    : currentConfig.nitSkill ?? normalizeNitSkillConfig();
  const skillsDir = currentConfig.skillsDir ?? await discoverSkillsDir(projDir);

  if (hasOverride || !currentConfig.nitSkill || !currentConfig.skillsDir) {
    currentConfig.skillsDir = skillsDir;
    currentConfig.nitSkill = nitSkillConfig;
    await writeConfig(nitDir, currentConfig);
  }

  const result = await createNitSkill(skillsDir, {
    skillSource: nitSkillConfig.source,
    skillUrl: nitSkillConfig.url,
    overwrite: true,
  });

  return {
    ...result,
    skillsDir,
    config: nitSkillConfig,
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
  const agentId = await loadAgentId(nitDir);
  const workingCard = await readWorkingCard(nitDir);
  const cardUrl = workingCard.url || defaultCardUrl(agentId);

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

  // Derive wallet addresses
  const walletAddresses = await getWalletAddresses(nitDir);

  return {
    agentId,
    cardUrl,
    branch: currentBranch,
    publicKey,
    walletAddresses,
    uncommittedChanges,
    branches: branchStatus,
  };
}

// ---------------------------------------------------------------------------
// sign
// ---------------------------------------------------------------------------

/**
 * Sign an arbitrary message with the agent's Ed25519 private key.
 * Returns a base64-encoded signature.
 */
export async function sign(
  message: string,
  options?: { projectDir?: string },
): Promise<string> {
  const nitDir = findNitDir(options?.projectDir);
  return signMessage(nitDir, message);
}

/**
 * Generate a login payload for app authentication.
 *
 * If no .nit/ exists, auto-initializes identity and pushes main (TOFU).
 * Automatically switches to (or creates) the domain branch,
 * then constructs the canonical message ({agent_id}\n{domain}\n{timestamp}),
 * signs it, and returns the full payload ready to send to an app.
 */
export async function loginPayload(
  domain: string,
  options?: { projectDir?: string },
): Promise<import('./types.js').LoginPayload & {
  switchedBranch?: string;
  createdSkill?: string;
  autoInitialized?: boolean;
  autoPushed?: boolean;
}> {
  let nitDir: string;
  let autoInitialized = false;
  let autoPushed = false;
  validateBranchName(domain);

  try {
    nitDir = findNitDir(options?.projectDir);
  } catch {
    // Auto-bootstrap: create identity, initial commit, and push
    await init(options);
    nitDir = findNitDir(options?.projectDir);
    autoInitialized = true;

    // Auto-push main (TOFU registration) — needed for server verification
    const pushResults = await push(options);
    const failed = pushResults.filter((r) => !r.success);
    if (failed.length > 0) {
      const details = failed.map((r) => `${r.branch}: ${r.error ?? 'push failed'}`).join('; ');
      throw new Error(`Auto-push failed after init: ${details}`);
    }
    autoPushed = true;
  }

  // Auto-checkout domain branch
  let switchedBranch: string | undefined;
  let createdSkill: string | undefined;
  const currentBranch = await getCurrentBranch(nitDir);
  if (currentBranch !== domain) {
    const isNew = !(await getBranch(nitDir, domain));
    if (isNew) {
      const headHash = await resolveHead(nitDir);
      await setBranch(nitDir, domain, headHash);
    }
    await checkout(domain, options);
    switchedBranch = domain;
  }

  // Ensure skill exists for this domain on every login (idempotent —
  // createSkillTemplate returns early if SKILL.md already exists)
  const projectDir = dirname(nitDir);
  const skillsDir = await getSkillsDir(nitDir) ?? await discoverSkillsDir(projectDir);
  if (skillsDir) {
    const skillId = await createSkillTemplate(skillsDir, domain);
    const card = await readWorkingCard(nitDir);
    if (!card.skills.some((s) => s.id === skillId)) {
      card.skills.push({ id: skillId });
      await writeWorkingCard(nitDir, card);
      createdSkill = skillId;
    }
  }

  const agentId = await loadAgentId(nitDir);
  const pubBase64 = await loadPublicKey(nitDir);
  const publicKey = formatPublicKeyField(pubBase64);
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${agentId}\n${domain}\n${timestamp}`;
  const signature = await signMessage(nitDir, message);
  return { agent_id: agentId, domain, timestamp, signature, public_key: publicKey, switchedBranch, createdSkill, autoInitialized, autoPushed };
}

function parseLoginPayloadShape(payload: unknown): LoginPayload {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Login payload must be a JSON object');
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.agent_id !== 'string' || p.agent_id.length === 0) {
    throw new Error('Login payload is missing agent_id');
  }
  validateAgentId(p.agent_id, 'Login payload agent_id');
  if (typeof p.domain !== 'string' || p.domain.length === 0) {
    throw new Error('Login payload is missing domain');
  }
  if (typeof p.timestamp !== 'number' || !Number.isFinite(p.timestamp)) {
    throw new Error('Login payload is missing timestamp');
  }
  if (!Number.isInteger(p.timestamp)) {
    throw new Error('Login payload timestamp must be an integer Unix second');
  }
  if (typeof p.signature !== 'string' || p.signature.length === 0) {
    throw new Error('Login payload is missing signature');
  }
  if (typeof p.public_key !== 'string' || p.public_key.length === 0) {
    throw new Error('Login payload is missing public_key');
  }
  return {
    agent_id: p.agent_id,
    domain: p.domain,
    timestamp: p.timestamp,
    signature: p.signature,
    public_key: p.public_key,
  };
}

function strictBase64ByteLength(value: string): number | null {
  if (!BASE64_RE.test(value)) {
    return null;
  }
  try {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.toString('base64') !== value) {
      return null;
    }
    return decoded.length;
  } catch {
    return null;
  }
}

/**
 * Verify a nit login payload locally against an agent card.
 *
 * This does not call newtype-ai.org. It derives the agent ID from the card's
 * publicKey, rebuilds the canonical login message, and verifies the Ed25519
 * signature directly.
 */
export function verifyLoginPayload(
  payload: unknown,
  card: unknown,
  options?: {
    expectedDomain?: string;
    maxAgeSeconds?: number;
    now?: number;
  },
): LoginVerificationResult {
  let parsed: LoginPayload | null = null;
  const now = options?.now ?? Math.floor(Date.now() / 1000);
  const maxAgeSeconds = options?.maxAgeSeconds ?? 300;

  const fail = (error: string, publicKey = parsed?.public_key ?? ''): LoginVerificationResult => ({
    verified: false,
    agent_id: parsed?.agent_id ?? '',
    domain: parsed?.domain ?? '',
    public_key: publicKey,
    age_seconds: parsed ? now - parsed.timestamp : 0,
    error,
  });

  try {
    parsed = parseLoginPayloadShape(payload);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  try {
    validateBranchName(parsed.domain);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  if (options?.expectedDomain) {
    try {
      validateBranchName(options.expectedDomain);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
    if (parsed.domain !== options.expectedDomain) {
      return fail(`Login payload domain "${parsed.domain}" does not match expected domain "${options.expectedDomain}"`);
    }
  }

  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds < 0) {
    return fail('maxAgeSeconds must be a non-negative finite number');
  }

  const ageSeconds = now - parsed.timestamp;
  if (ageSeconds > maxAgeSeconds) {
    return fail(`Login payload is stale by ${ageSeconds - maxAgeSeconds}s`);
  }
  if (ageSeconds < -maxAgeSeconds) {
    return fail(`Login payload timestamp is ${Math.abs(ageSeconds) - maxAgeSeconds}s too far in the future`);
  }

  let agentCard: AgentCard;
  try {
    assertAgentCardShape(card);
    agentCard = card;
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  if (!agentCard.publicKey) {
    return fail('Agent card has no publicKey');
  }

  if (parsed.public_key !== agentCard.publicKey) {
    return fail('Login payload public_key does not match card publicKey', agentCard.publicKey);
  }

  let pubBase64: string;
  try {
    pubBase64 = parsePublicKeyField(agentCard.publicKey);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), agentCard.publicKey);
  }

  if (strictBase64ByteLength(pubBase64) !== 32) {
    return fail('Agent card publicKey must contain a 32-byte Ed25519 key', agentCard.publicKey);
  }

  if (deriveAgentId(agentCard.publicKey) !== parsed.agent_id) {
    return fail('Login payload agent_id does not match card publicKey', agentCard.publicKey);
  }

  if (strictBase64ByteLength(parsed.signature) !== 64) {
    return fail('Login payload signature must be a 64-byte Ed25519 signature', agentCard.publicKey);
  }

  const message = `${parsed.agent_id}\n${parsed.domain}\n${parsed.timestamp}`;
  if (!verifySignature(pubBase64, message, parsed.signature)) {
    return fail('Login payload signature is invalid', agentCard.publicKey);
  }

  return {
    verified: true,
    agent_id: parsed.agent_id,
    domain: parsed.domain,
    public_key: agentCard.publicKey,
    age_seconds: ageSeconds,
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
  card = await normalizeCardForLocalIdentity(nitDir, card, CARD_FILE);

  // Write the resolved card back (skills + publicKey + wallet may have updated)
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
  const timestamp = Math.floor(Date.now() / 1000);
  const commitContent = serializeCommit({
    card: cardHash,
    parent: parentHash,
    author,
    timestamp,
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
    timestamp,
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
    validateBranchName(name);
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

/**
 * Delete a branch (local, and optionally remote).
 * Cannot delete 'main' or the currently checked-out branch.
 */
export async function branchDelete(
  name: string,
  options?: { projectDir?: string; remote?: boolean; remoteName?: string },
): Promise<void> {
  validateBranchName(name);
  const nitDir = findNitDir(options?.projectDir);

  if (name === 'main') {
    throw new Error('Cannot delete the main branch.');
  }

  const currentBranch = await getCurrentBranch(nitDir);
  if (name === currentBranch) {
    throw new Error(`Cannot delete the currently checked-out branch '${name}'. Switch to another branch first.`);
  }

  const existing = await getBranch(nitDir, name);
  if (!existing) {
    throw new Error(`Branch '${name}' does not exist.`);
  }

  // Delete from remote server if requested
  const remoteName = options?.remoteName || 'origin';
  if (options?.remote) {
    const apiBase = await resolveRemoteUrl(nitDir, remoteName);
    await deleteRemoteBranch(nitDir, apiBase, name);
  }

  // Delete local ref after remote delete succeeds, so -D is not partially
  // destructive when the server rejects or cannot process the request.
  await deleteLocalBranch(nitDir, name);

  // Clean up remote-tracking ref
  await deleteRemoteRef(nitDir, remoteName, name);
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
): Promise<{ autoCommitted?: boolean }> {
  validateBranchName(branchName);
  const nitDir = findNitDir(options?.projectDir);
  let autoCommitted = false;

  // Auto-commit uncommitted changes (nit manages its own state)
  const headHash = await resolveHead(nitDir);
  const headCard = await getCardAtCommit(nitDir, headHash);
  const workingCard = await readWorkingCard(nitDir);
  const d = diffCards(headCard, workingCard);
  if (d.changed) {
    try {
      await commit(`auto-save before switching to ${branchName}`, options);
      autoCommitted = true;
    } catch (commitErr) {
      if (!(commitErr instanceof Error && commitErr.message.includes('Nothing to commit'))) {
        throw commitErr;
      }
    }
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
  return { autoCommitted };
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
  const apiBase = await resolveRemoteUrl(nitDir, remoteName);
  const branches = await listAllBranches(nitDir);
  const currentBranch = await getCurrentBranch(nitDir);

  const toPush = options?.all
    ? [
        ...branches.filter((b) => b.name === 'main'),
        ...branches.filter((b) => b.name !== 'main'),
      ]
    : branches.filter((b) => b.name === currentBranch);

  if (toPush.length === 0) {
    throw new Error('No branches to push.');
  }

  // Load machine hash for TOFU registration (sent on main branch pushes)
  const machineHash = await loadMachineHash(nitDir);

  const results: PushResult[] = [];

  for (const b of toPush) {
    // Read the card at this branch's commit
    const commitRaw = await readObject(nitDir, b.commitHash);
    const c = parseCommit(b.commitHash, commitRaw);
    const cardJson = await readObject(nitDir, c.card);

    const result = await remotePushBranch(
      nitDir,
      apiBase,
      b.name,
      cardJson,
      b.commitHash,
      b.name === 'main' ? machineHash : undefined,
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
  agentId: string;
}

/**
 * Show remote info. URL comes from .nit/config, agent ID from .nit/identity/.
 */
export async function remote(options?: {
  projectDir?: string;
  remoteName?: string;
}): Promise<RemoteInfo> {
  const nitDir = findNitDir(options?.projectDir);
  const remoteName = options?.remoteName || 'origin';
  const remoteUrl = await resolveRemoteUrl(nitDir, remoteName);
  const agentId = await loadAgentId(nitDir);

  return {
    name: remoteName,
    url: remoteUrl,
    agentId,
  };
}

export async function remoteBranches(options?: {
  projectDir?: string;
  remoteName?: string;
}): Promise<string[]> {
  const nitDir = findNitDir(options?.projectDir);
  const remoteName = options?.remoteName || 'origin';
  const apiBase = await resolveRemoteUrl(nitDir, remoteName);
  return listRemoteBranches(nitDir, apiBase);
}

export interface RemoteCheckResult {
  name: string;
  url: string;
  health: {
    checked: boolean;
    ok: boolean;
    status?: number;
    optional?: boolean;
    error?: string;
  };
  branches: {
    ok: boolean;
    names: string[];
    error?: string;
  };
}

export async function remoteCheck(options?: {
  projectDir?: string;
  remoteName?: string;
}): Promise<RemoteCheckResult> {
  const nitDir = findNitDir(options?.projectDir);
  const remoteName = options?.remoteName || 'origin';
  const apiBase = await resolveRemoteUrl(nitDir, remoteName);

  const result: RemoteCheckResult = {
    name: remoteName,
    url: apiBase,
    health: { checked: true, ok: false },
    branches: { ok: false, names: [] },
  };

  try {
    const res = await fetchWithTimeout(new URL('/health', apiBase).toString(), {
      headers: { accept: 'application/json' },
    }, {
      label: 'Remote health check',
      timeoutMs: 5_000,
    });
    result.health.status = res.status;
    result.health.ok = res.ok || res.status === 404;
    result.health.optional = res.status === 404;
  } catch (err) {
    result.health.error = err instanceof Error ? err.message : String(err);
  }

  try {
    result.branches.names = await listRemoteBranches(nitDir, apiBase);
    result.branches.ok = true;
  } catch (err) {
    result.branches.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

/**
 * Add a new named remote with a URL.
 */
export async function remoteAdd(
  name: string,
  url: string,
  options?: { projectDir?: string },
): Promise<void> {
  validateRemoteName(name);
  validateHttpUrl(url, 'Remote URL');
  const nitDir = findNitDir(options?.projectDir);
  const config = await readConfig(nitDir);
  if (config.remotes[name]) {
    throw new Error(
      `Remote "${name}" already exists. Use 'nit remote set-url ${name} <url>' to change it.`,
    );
  }
  config.remotes[name] = { url };
  await writeConfig(nitDir, config);
}

/**
 * Change the URL for an existing remote.
 */
export async function remoteSetUrl(
  name: string,
  url: string,
  options?: { projectDir?: string },
): Promise<void> {
  validateRemoteName(name);
  validateHttpUrl(url, 'Remote URL');
  const nitDir = findNitDir(options?.projectDir);
  const config = await readConfig(nitDir);
  if (!config.remotes[name]) {
    throw new Error(
      `Remote "${name}" does not exist. Use 'nit remote add ${name} <url>' to create it.`,
    );
  }
  await configSetRemoteUrl(nitDir, name, url);
}

// ---------------------------------------------------------------------------
// sign-tx / broadcast / rpc
// ---------------------------------------------------------------------------

/**
 * Sign transaction data with the agent's identity-derived key.
 *
 * EVM: pass a 32-byte keccak256 hash (hex). Returns ECDSA signature.
 * Solana: pass serialized message bytes (hex). Returns Ed25519 signature.
 */
export async function signTx(
  chain: 'evm' | 'solana',
  data: string,
  options?: { projectDir?: string },
): Promise<SignTxResult> {
  const nitDir = findNitDir(options?.projectDir);
  return txSignTx(nitDir, chain, data);
}

/**
 * Broadcast a signed transaction to the configured RPC endpoint.
 */
export async function broadcast(
  chain: 'evm' | 'solana',
  signedTx: string,
  options?: { projectDir?: string; rpcUrl?: string },
): Promise<BroadcastResult> {
  const nitDir = findNitDir(options?.projectDir);
  return txBroadcast(nitDir, chain, signedTx, options?.rpcUrl);
}

/**
 * Set the RPC endpoint URL for a chain.
 */
export async function rpcSetUrl(
  chain: string,
  url: string,
  options?: { projectDir?: string },
): Promise<void> {
  const nitDir = findNitDir(options?.projectDir);
  validateRpcChainName(chain);
  await configSetRpcUrl(nitDir, chain, url);
}

/**
 * Get all configured RPC endpoints.
 */
export async function rpcInfo(
  options?: { projectDir?: string },
): Promise<Record<string, NitRpcConfig>> {
  const nitDir = findNitDir(options?.projectDir);
  const config = await readConfig(nitDir);
  return config.rpc ?? {};
}

// ---------------------------------------------------------------------------
// runtime (self-declared LLM provider identity)
// ---------------------------------------------------------------------------

/**
 * Set the self-declared runtime attestation. Injected into the card at commit time.
 */
export async function runtimeSet(
  provider: string,
  model: string,
  harness: string,
  options?: { projectDir?: string },
): Promise<AgentRuntime> {
  const nitDir = findNitDir(options?.projectDir);
  return configSetRuntime(nitDir, provider, model, harness);
}

/**
 * Get the currently configured runtime, or null if not set.
 */
export async function runtimeShow(
  options?: { projectDir?: string },
): Promise<AgentRuntime | null> {
  const nitDir = findNitDir(options?.projectDir);
  return configGetRuntime(nitDir);
}

/**
 * Clear the runtime from config.
 */
export async function runtimeUnset(
  options?: { projectDir?: string },
): Promise<void> {
  const nitDir = findNitDir(options?.projectDir);
  await configClearRuntime(nitDir);
}

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

/**
 * Restore agent-card.json from a commit, discarding uncommitted changes.
 *
 * - No target: restore from HEAD (discard all uncommitted changes)
 * - Commit hash or branch name: restore card from that commit
 *
 * Does NOT move the branch pointer — only overwrites the working card.
 */
export async function reset(
  target?: string,
  options?: { projectDir?: string },
): Promise<{ hash: string }> {
  const nitDir = findNitDir(options?.projectDir);

  let commitHash: string;
  if (!target) {
    commitHash = await resolveHead(nitDir);
  } else {
    // Check if target is a branch name
    const branchHash = await getBranch(nitDir, target);
    if (branchHash) {
      commitHash = branchHash;
    } else if (/^[0-9a-f]{64}$/.test(target)) {
      commitHash = target;
    } else {
      throw new Error(`Unknown target "${target}". Provide a branch name or commit hash.`);
    }
  }

  const card = await getCardAtCommit(nitDir, commitHash);
  await writeWorkingCard(nitDir, card);
  return { hash: commitHash };
}

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

export interface ShowResult {
  hash: string;
  card: string;
  parent: string | null;
  author: string;
  timestamp: number;
  message: string;
  cardJson: AgentCard;
}

/**
 * Show a commit's metadata and card content.
 *
 * - No target: show HEAD
 * - Commit hash or branch name: show that commit
 */
export async function show(
  target?: string,
  options?: { projectDir?: string },
): Promise<ShowResult> {
  const nitDir = findNitDir(options?.projectDir);

  let commitHash: string;
  if (!target) {
    commitHash = await resolveHead(nitDir);
  } else {
    const branchHash = await getBranch(nitDir, target);
    if (branchHash) {
      commitHash = branchHash;
    } else if (/^[0-9a-f]{64}$/.test(target)) {
      commitHash = target;
    } else {
      throw new Error(`Unknown target "${target}". Provide a branch name or commit hash.`);
    }
  }

  const commitRaw = await readObject(nitDir, commitHash);
  const c = parseCommit(commitHash, commitRaw);
  const cardJson = await getCardAtCommit(nitDir, commitHash);

  return {
    hash: c.hash,
    card: c.card,
    parent: c.parent,
    author: c.author,
    timestamp: c.timestamp,
    message: c.message,
    cardJson,
  };
}

// ---------------------------------------------------------------------------
// pull
// ---------------------------------------------------------------------------

export interface PullResult {
  branch: string;
  commitHash: string;
  updated: boolean;
  error?: string;
}

/**
 * Fetch current branch (or all branches) from the remote and update local state.
 *
 * 1. Fetch card JSON from remote
 * 2. Write card to object store
 * 3. Create a commit object
 * 4. Update branch ref + remote-tracking ref
 * 5. Write card to working copy (current branch only)
 */
export async function pull(options?: {
  projectDir?: string;
  remoteName?: string;
  all?: boolean;
}): Promise<PullResult[]> {
  const nitDir = findNitDir(options?.projectDir);
  const remoteName = options?.remoteName || 'origin';
  const apiBase = await resolveRemoteUrl(nitDir, remoteName);
  const currentBranch = await getCurrentBranch(nitDir);
  const agentId = await loadAgentId(nitDir);

  const branches = options?.all
    ? await listAllBranches(nitDir)
    : [{ name: currentBranch, commitHash: await resolveHead(nitDir) }];

  const results: PullResult[] = [];

  for (const b of branches) {
    try {
      // Fetch card from remote — fetchBranchCard(cardUrl, branch, nitDir?)
      const { fetchBranchCard } = await import('./remote.js');
      const cardUrl = cardReadBaseUrl(apiBase, agentId);
      const fetchedCard = await fetchBranchCard(cardUrl, b.name, nitDir);
      const remoteCard = await normalizeCardForLocalIdentity(
        nitDir,
        fetchedCard,
        `Remote branch "${b.name}"`,
      );

      // Write card to object store
      const cardJson = JSON.stringify(remoteCard, null, 2);
      const cardHash = await writeObject(nitDir, 'card', cardJson);

      // Check if card differs from local
      const localHash = await getBranch(nitDir, b.name);
      if (localHash) {
        const localRaw = await readObject(nitDir, localHash);
        const localCommit = parseCommit(localHash, localRaw);
        if (localCommit.card === cardHash) {
          results.push({ branch: b.name, commitHash: localHash, updated: false });
          continue;
        }
      }

      // Create commit
      const author = remoteCard.name || b.name;
      const timestamp = Math.floor(Date.now() / 1000);
      const commitContent = serializeCommit({
        card: cardHash,
        parent: localHash,
        author,
        timestamp,
        message: `Pull from ${remoteName}`,
      });
      const commitHash = await writeObject(nitDir, 'commit', commitContent);

      // Update refs
      await setBranch(nitDir, b.name, commitHash);
      await setRemoteRef(nitDir, remoteName, b.name, commitHash);

      // Update working copy if this is the current branch
      if (b.name === currentBranch) {
        await writeWorkingCard(nitDir, remoteCard);
      }

      results.push({ branch: b.name, commitHash, updated: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ branch: b.name, commitHash: '', updated: false, error: msg });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// auth — per-branch OAuth config for OpenClaw browser automation
// ---------------------------------------------------------------------------

export interface AuthSetResult {
  branch: string;
  skillId: string;
  provider: AuthProvider;
  account: string;
  switchedBranch?: string;
  createdBranch?: boolean;
}

export interface AuthShowResult {
  branch: string;
  auth: AuthConfig | null;
}

/**
 * Configure OAuth authentication for a branch.
 *
 * 1. Switches to the target branch (creates if needed)
 * 2. Updates the branch's SKILL.md with auth frontmatter + consent instructions
 * 3. Adds skill pointer to agent-card.json if not present
 *
 * The SKILL.md tells OpenClaw which OAuth provider and account to use when
 * the agent encounters a login page. The agent reuses the human's existing
 * Chrome session (browser-profile = user) and only handles OAuth consent
 * flows — never enters credentials.
 */
export async function authSet(
  domain: string,
  provider: AuthProvider,
  account: string,
  options?: { projectDir?: string },
): Promise<AuthSetResult> {
  validateBranchName(domain);
  if (!['google', 'github', 'x'].includes(provider)) {
    throw new Error('Auth provider must be one of: google, github, x');
  }
  if (!account) {
    throw new Error('Auth account cannot be empty');
  }
  validateConfigValue(account, 'Auth account');
  const nitDir = findNitDir(options?.projectDir);
  const projDir = projectDir(nitDir);

  // Switch to domain branch (create if needed)
  let switchedBranch: string | undefined;
  let createdBranch = false;
  const currentBranch = await getCurrentBranch(nitDir);
  if (currentBranch !== domain) {
    const isNew = !(await getBranch(nitDir, domain));
    if (isNew) {
      const headHash = await resolveHead(nitDir);
      await setBranch(nitDir, domain, headHash);
      createdBranch = true;
    }
    await checkout(domain, options);
    switchedBranch = domain;
  }

  // Resolve skills directory
  const skillsDir = await getSkillsDir(nitDir) ?? await discoverSkillsDir(projDir);

  // Update SKILL.md with auth config + instructions
  const auth: AuthConfig = { provider, account };
  const skillId = await updateSkillAuth(skillsDir, domain, auth);

  // Add skill pointer to agent card if not present
  const card = await readWorkingCard(nitDir);
  if (!card.skills.some((s) => s.id === skillId)) {
    card.skills.push({ id: skillId });
    await writeWorkingCard(nitDir, card);
  }

  return { branch: domain, skillId, provider, account, switchedBranch, createdBranch };
}

/**
 * Show auth config for a specific branch, or all branches with auth configured.
 */
export async function authShow(
  domain?: string,
  options?: { projectDir?: string },
): Promise<AuthShowResult[]> {
  const nitDir = findNitDir(options?.projectDir);
  const projDir = projectDir(nitDir);
  const skillsDir = await getSkillsDir(nitDir) ?? await discoverSkillsDir(projDir);
  const results: AuthShowResult[] = [];

  if (domain) {
    // Show auth for a specific branch
    const auth = await readSkillAuth(skillsDir, domain);
    results.push({ branch: domain, auth });
  } else {
    // Show auth for all branches
    const branches = await listAllBranches(nitDir);
    for (const b of branches) {
      const auth = await readSkillAuth(skillsDir, b.name);
      if (auth) {
        results.push({ branch: b.name, auth });
      }
    }
  }

  return results;
}
