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

/** Where nit's own SKILL.md should come from. */
export type NitSkillSource = 'newtype' | 'url' | 'embedded' | 'none';

/** Configuration for the bundled nit skill installed into the skills dir. */
export interface NitSkillConfig {
  /** Default is "newtype"; "url" uses a custom URL; "embedded" is local-only; "none" disables install/refresh. */
  source: NitSkillSource;
  /** Remote SKILL.md URL for "newtype" or "url" sources. */
  url?: string;
}

/** Full .nit/config file contents. */
export interface NitConfig {
  /** Keyed by remote name (e.g. "origin") */
  remotes: Record<string, NitRemoteConfig>;
  /** Discovered skills directory path */
  skillsDir?: string;
  /** Source configuration for nit's own SKILL.md. */
  nitSkill?: NitSkillConfig;
  /** RPC endpoints keyed by chain name (e.g. "evm", "solana") */
  rpc?: Record<string, NitRpcConfig>;
  /** Self-declared LLM runtime (injected into card at commit time). */
  runtime?: AgentRuntime;
}

/** Self-declared runtime attestation — which LLM powers the agent. */
export interface AgentRuntime {
  /** LLM provider (e.g., "anthropic", "openai", "google", "openrouter", "huggingface", "local"). */
  provider: string;
  /** Model identifier (self-reported, e.g., "claude-opus-4-6"). */
  model: string;
  /** Harness that runs the agent (e.g., "claude-code", "openclaw", "managed-agents", "codex"). */
  harness: string;
  /** Unix timestamp when runtime was declared. */
  declared_at: number;
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
  /** Chain wallet addresses derived from the agent's Ed25519 keypair. */
  wallet?: {
    solana: string;
    evm: string;
  };
  /** Self-declared LLM runtime (optional). Apps can check consistency or display provider info. */
  runtime?: AgentRuntime;
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

/** OAuth provider for per-branch authentication config. */
export type AuthProvider = 'google' | 'github' | 'x';

/** Per-branch authentication configuration stored in SKILL.md frontmatter. */
export interface AuthConfig {
  provider: AuthProvider;
  account: string;
}

/** Result of generating a login payload for app authentication. */
export interface LoginPayload {
  agent_id: string;
  domain: string;
  timestamp: number;
  signature: string;
  /** Agent's public key ("ed25519:<base64>") for transparency. */
  public_key: string;
}

/** Result of verifying a nit login payload locally. */
export interface LoginVerificationResult {
  verified: boolean;
  agent_id: string;
  domain: string;
  public_key: string;
  age_seconds: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Identity registry types (server verify endpoint)
// ---------------------------------------------------------------------------

/** Identity metadata returned by the server's verify endpoint. */
export interface IdentityMetadata {
  registration_timestamp: number | null;
  machine_identity_count: number;
  ip_identity_count: number;
  total_logins: number;
  last_login_timestamp: number | null;
  unique_domains: number;
}

/** App-defined trust policy for the verify endpoint. */
export interface VerifyPolicy {
  max_identities_per_ip?: number;
  max_identities_per_machine?: number;
  min_age_seconds?: number;
  max_login_rate_per_hour?: number;
}

/** Server attestation included in the verify response. */
export interface ServerAttestation {
  server_signature: string;
  server_url: string;
  server_public_key: string;
}

// ---------------------------------------------------------------------------
// Runtime shape validation
// ---------------------------------------------------------------------------

const MAX_STRING_FIELD_LENGTH = 8192;
const MAX_SKILLS = 500;
const MAX_ARRAY_ITEMS = 500;

function assertStringValue(value: unknown, label: string, options?: { required?: boolean }): string | undefined {
  if (value === undefined) {
    if (options?.required) {
      throw new Error(`Invalid agent-card.json: ${label} is required`);
    }
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`Invalid agent-card.json: ${label} must be a string`);
  }
  if (value.length > MAX_STRING_FIELD_LENGTH) {
    throw new Error(`Invalid agent-card.json: ${label} is too long`);
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
    throw new Error(`Invalid agent-card.json: ${label} must not contain control characters`);
  }
  return value;
}

function assertStringArray(value: unknown, label: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid agent-card.json: ${label} must be an array`);
  }
  if (value.length > MAX_ARRAY_ITEMS) {
    throw new Error(`Invalid agent-card.json: ${label} has too many items`);
  }
  for (const [index, item] of value.entries()) {
    assertStringValue(item, `${label}[${index}]`, { required: true });
  }
}

function assertOptionalStringArray(obj: Record<string, unknown>, key: string, label: string): void {
  if (key in obj) {
    assertStringArray(obj[key], label);
  }
}

/**
 * Lightweight runtime shape check for parsed agent-card.json.
 *
 * Does NOT enforce required fields (that's validateAndFillCard's job at
 * commit time).  Only verifies that present fields have the correct JS type
 * so downstream code never operates on garbage data.
 */
export function assertAgentCardShape(obj: unknown): asserts obj is AgentCard {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Invalid agent-card.json: root must be a JSON object');
  }
  const o = obj as Record<string, unknown>;
  assertStringValue(o.name, 'name');
  assertStringValue(o.description, 'description');
  assertStringValue(o.protocolVersion, 'protocolVersion');
  assertStringValue(o.version, 'version');
  assertStringValue(o.url, 'url');
  assertStringValue(o.publicKey, 'publicKey');
  assertStringValue(o.iconUrl, 'iconUrl');
  assertStringValue(o.documentationUrl, 'documentationUrl');

  if ('defaultInputModes' in o) {
    assertStringArray(o.defaultInputModes, 'defaultInputModes');
  }
  if ('defaultOutputModes' in o) {
    assertStringArray(o.defaultOutputModes, 'defaultOutputModes');
  }

  if ('skills' in o) {
    if (!Array.isArray(o.skills)) {
      throw new Error('Invalid agent-card.json: skills must be an array');
    }
    if (o.skills.length > MAX_SKILLS) {
      throw new Error('Invalid agent-card.json: skills has too many items');
    }
    for (const [index, skill] of o.skills.entries()) {
      if (skill === null || typeof skill !== 'object' || Array.isArray(skill)) {
        throw new Error(`Invalid agent-card.json: skills[${index}] must be a JSON object`);
      }
      const s = skill as Record<string, unknown>;
      const id = assertStringValue(s.id, `skills[${index}].id`, { required: true });
      if (!id?.trim()) {
        throw new Error(`Invalid agent-card.json: skills[${index}].id cannot be empty`);
      }
      assertStringValue(s.name, `skills[${index}].name`);
      assertStringValue(s.description, `skills[${index}].description`);
      assertOptionalStringArray(s, 'tags', `skills[${index}].tags`);
      assertOptionalStringArray(s, 'examples', `skills[${index}].examples`);
      assertOptionalStringArray(s, 'inputModes', `skills[${index}].inputModes`);
      assertOptionalStringArray(s, 'outputModes', `skills[${index}].outputModes`);
    }
  }

  if ('provider' in o) {
    if (o.provider === null || typeof o.provider !== 'object' || Array.isArray(o.provider)) {
      throw new Error('Invalid agent-card.json: provider must be a JSON object');
    }
    const p = o.provider as Record<string, unknown>;
    assertStringValue(p.organization, 'provider.organization');
    assertStringValue(p.url, 'provider.url');
  }

  if ('wallet' in o) {
    if (o.wallet === null || typeof o.wallet !== 'object' || Array.isArray(o.wallet)) {
      throw new Error('Invalid agent-card.json: wallet must be a JSON object');
    }
    const w = o.wallet as Record<string, unknown>;
    assertStringValue(w.solana, 'wallet.solana');
    assertStringValue(w.evm, 'wallet.evm');
  }

  if ('runtime' in o) {
    if (o.runtime === null || typeof o.runtime !== 'object' || Array.isArray(o.runtime))
      throw new Error('Invalid agent-card.json: runtime must be a JSON object');
    const r = o.runtime as Record<string, unknown>;
    assertStringValue(r.provider, 'runtime.provider');
    assertStringValue(r.model, 'runtime.model');
    assertStringValue(r.harness, 'runtime.harness');
    if ('declared_at' in r && (typeof r.declared_at !== 'number' || !Number.isFinite(r.declared_at)))
      throw new Error('Invalid agent-card.json: runtime.declared_at must be a finite number');
  }
}
