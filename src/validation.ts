// ---------------------------------------------------------------------------
// nit — Shared validation helpers
// ---------------------------------------------------------------------------

const REF_NAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;
const RPC_CHAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;
const AGENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertSingleLine(value: string, label: string): void {
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${label} must not contain control characters`);
  }
}

/**
 * Validate a branch name for both filesystem refs and server KV keys.
 */
export function validateBranchName(name: string): void {
  if (!name) {
    throw new Error('Branch name cannot be empty.');
  }
  if (name.length > 253) {
    throw new Error('Branch name cannot exceed 253 characters.');
  }
  assertSingleLine(name, 'Branch name');
  if (/[:/\\]/.test(name) || name.includes('..')) {
    throw new Error(
      `Branch name "${name}" contains unsafe characters. Avoid : / \\ and ..`,
    );
  }
  if (!REF_NAME_RE.test(name)) {
    throw new Error(
      `Branch name "${name}" is invalid. Use letters, digits, dots, underscores, or hyphens; must start and end with alphanumeric.`,
    );
  }
}

/**
 * Validate a remote name before it is used as an INI section or ref directory.
 */
export function validateRemoteName(name: string): void {
  if (!name) {
    throw new Error('Remote name cannot be empty.');
  }
  if (name.length > 100) {
    throw new Error('Remote name cannot exceed 100 characters.');
  }
  assertSingleLine(name, 'Remote name');
  if (/[:/\\"]/.test(name) || name.includes('..')) {
    throw new Error(
      `Remote name "${name}" contains unsafe characters. Avoid : / \\ " and ..`,
    );
  }
  if (!REF_NAME_RE.test(name)) {
    throw new Error(
      `Remote name "${name}" is invalid. Use letters, digits, dots, underscores, or hyphens; must start and end with alphanumeric.`,
    );
  }
}

/**
 * Validate an RPC chain key before it is used as an INI section.
 */
export function validateRpcChainName(chain: string): void {
  if (!chain) {
    throw new Error('RPC chain name cannot be empty.');
  }
  if (chain.length > 100) {
    throw new Error('RPC chain name cannot exceed 100 characters.');
  }
  assertSingleLine(chain, 'RPC chain name');
  if (/[:/\\"]/.test(chain) || chain.includes('..')) {
    throw new Error(
      `RPC chain name "${chain}" contains unsafe characters. Avoid : / \\ " and ..`,
    );
  }
  if (!RPC_CHAIN_RE.test(chain)) {
    throw new Error(
      `RPC chain name "${chain}" is invalid. Use letters, digits, dots, underscores, or hyphens; must start and end with alphanumeric.`,
    );
  }
}

/**
 * Validate that a URL uses a network-safe scheme.
 */
export function validateHttpUrl(url: string, label: string): void {
  assertSingleLine(url, label);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use http:// or https://`);
  }
}

/**
 * Values stored in .nit/config are line-oriented. Keep them single-line.
 */
export function validateConfigValue(value: string, label: string): void {
  assertSingleLine(value, label);
}

export function validateObjectHash(hash: string, label = 'Object hash'): void {
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error(`${label} must be a 64-character lowercase hex SHA-256 hash`);
  }
}

export function validateAgentId(agentId: string, label = 'Agent ID'): void {
  if (!agentId) {
    throw new Error(`${label} cannot be empty`);
  }
  assertSingleLine(agentId, label);
  if (!AGENT_ID_RE.test(agentId)) {
    throw new Error(`${label} must be a UUIDv5`);
  }
}
