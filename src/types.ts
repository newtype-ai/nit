// ---------------------------------------------------------------------------
// nit — Version control for agent cards
// Type definitions
// ---------------------------------------------------------------------------

/** Content-addressable card object (analogous to a git blob). */
export interface NitCardObject {
  type: 'card';
  /** SHA-256 hex digest */
  hash: string;
  /** Raw JSON string of agent-card.json */
  content: string;
}

/** Commit object referencing a card snapshot. */
export interface NitCommit {
  type: 'commit';
  /** SHA-256 hex digest of the serialized commit */
  hash: string;
  /** Card object hash */
  card: string;
  /** Parent commit hash (null for initial commit) */
  parent: string | null;
  /** Author name or ID */
  author: string;
  /** Unix timestamp in seconds */
  timestamp: number;
  /** Commit message */
  message: string;
}

/** A branch is a named pointer to a commit hash. */
export interface NitBranch {
  name: string;
  commitHash: string;
}

/** HEAD is always a symbolic ref pointing to a branch. */
export interface NitHead {
  type: 'ref';
  /** e.g. "refs/heads/main" */
  ref: string;
}

/** Remote configuration for a single named remote. */
export interface NitRemoteConfig {
  /** API base URL (e.g. "https://api.newtype-ai.org") */
  url?: string;
  /** Legacy field — push auth is now via Ed25519 keypair */
  credential?: string;
}

/** RPC endpoint configuration for a specific chain. */
export interface NitRpcConfig {
  /** JSON-RPC endpoint URL */
  url: string;
}

/** Full .nit/config file contents. */
export interface NitConfig {
  /** Keyed by remote name (e.g. "origin") */
  remotes: Record<string, NitRemoteConfig>;
  /** Discovered skills directory path */
  skillsDir?: string;
  /** RPC endpoints keyed by chain name (e.g. "evm", "solana") */
  rpc?: Record<string, NitRpcConfig>;
}

/** A2A-compatible agent card. */
export interface AgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  version: string;
  url: string;
  /** Format: "ed25519:<base64>" — present only on main branch */
  publicKey?: string;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentCardSkill[];
  iconUrl?: string;
  documentationUrl?: string;
  provider?: {
    organization: string;
    url?: string;
  };
}

/** A single skill entry in an agent card.
 *  Can be a full skill (all fields) or a pointer (just id).
 *  At commit time, pointers are resolved from SKILL.md files. */
export interface AgentCardSkill {
  id: string;
  name?: string;
  description?: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

/** Metadata extracted from a SKILL.md frontmatter. */
export interface SkillMetadata {
  /** Directory name (e.g. "seo-audit") */
  id: string;
  /** From frontmatter `name` field */
  name: string;
  /** From frontmatter `description` field */
  description: string;
  /** From frontmatter `metadata.version` */
  version?: string;
  /** Full filesystem path to the SKILL.md */
  path: string;
}

/** Structured diff between two agent cards. */
export interface DiffResult {
  changed: boolean;
  fields: FieldDiff[];
  skillsAdded: string[];
  skillsRemoved: string[];
  skillsModified: string[];
}

/** A single field-level change. */
export interface FieldDiff {
  field: string;
  old: unknown;
  new: unknown;
}

/** Result of pushing a branch to a remote. */
export interface PushResult {
  branch: string;
  commitHash: string;
  remoteUrl: string;
  success: boolean;
  error?: string;
}

/** Wallet addresses derived from the agent's Ed25519 keypair. */
export interface WalletAddresses {
  solana: string;
  ethereum: string;
}

/** Result returned by the status command. */
export interface StatusResult {
  agentId: string;
  cardUrl: string;
  branch: string;
  publicKey: string;
  walletAddresses: WalletAddresses;
  uncommittedChanges: DiffResult | null;
  branches: Array<{
    name: string;
    ahead: number;
    behind: number;
  }>;
}

/** Result of signing transaction data. */
export interface SignTxResult {
  /** Chain that was signed for */
  chain: 'evm' | 'solana';
  /** The signature (EVM: "0x{r}{s}{v}" 130 hex chars, Solana: base64 64-byte Ed25519) */
  signature: string;
  /** EVM only: recovery parameter (0 or 1) for agent to compute chain-specific v */
  recovery?: number;
  /** The signer address */
  address: string;
}

/** Result of broadcasting a signed transaction. */
export interface BroadcastResult {
  /** Chain that was broadcast to */
  chain: 'evm' | 'solana';
  /** Transaction hash (EVM) or signature (Solana) */
  txHash: string;
  /** RPC endpoint used */
  rpcUrl: string;
}

/** Result of generating a login payload for app authentication. */
export interface LoginPayload {
  agent_id: string;
  domain: string;
  timestamp: number;
  signature: string;
}
