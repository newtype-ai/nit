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
  /** Legacy field — push auth is now via Ed25519 keypair */
  credential?: string;
}

/** Full .nit/config file contents. */
export interface NitConfig {
  /** Keyed by remote name (e.g. "origin") */
  remotes: Record<string, NitRemoteConfig>;
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

/** A single skill entry in an agent card. */
export interface AgentCardSkill {
  id: string;
  name: string;
  description: string;
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

/** Result returned by the status command. */
export interface StatusResult {
  agentId: string;
  cardUrl: string;
  branch: string;
  publicKey: string;
  uncommittedChanges: DiffResult | null;
  branches: Array<{
    name: string;
    ahead: number;
    behind: number;
  }>;
}

/** Result of generating a login payload for app authentication. */
export interface LoginPayload {
  agent_id: string;
  domain: string;
  timestamp: number;
  signature: string;
}
