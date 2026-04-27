// ---------------------------------------------------------------------------
// nit — Remote HTTP client
//
// Handles push/pull of agent card branches to a nit-compatible remote.
//
// Write endpoints (Ed25519 signature auth):
//   PUT    /agent-card/branches/{branch}
//   GET    /agent-card/branches
//   DELETE /agent-card/branches/{branch}
//
// Read endpoints (at agent's card URL, challenge-response for non-main):
//   GET /.well-known/agent-card.json
//   GET /.well-known/agent-card.json?branch=faam.io
//
// The API base URL is configured per-remote in .nit/config.
// Default: https://api.newtype-ai.org (free hosting by newtype-ai.org)
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { hostname, platform, arch } from 'node:os';
import { assertAgentCardShape, type AgentCard, type PushResult } from './types.js';
import { loadAgentId, signMessage, signChallenge } from './identity.js';
import { version } from './update-check.js';
import { validateBranchName, validateHttpUrl } from './validation.js';

// Client-declared signals (server stores but treats as untrusted)
const platformSignal = `${platform()}-${arch()}`;
const hostnameHash = createHash('sha256').update(hostname()).digest('hex');
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  label = 'Remote request',
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) {
      throw new Error(`${label} timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseText(
  res: Response,
  label: string,
  maxBytes = MAX_RESPONSE_BYTES,
): Promise<string> {
  const length = res.headers.get('content-length');
  if (length && Number.parseInt(length, 10) > maxBytes) {
    throw new Error(`${label} exceeds ${maxBytes} bytes`);
  }

  if (!res.body) {
    const text = await res.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error(`${label} exceeds ${maxBytes} bytes`);
    }
    return text;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`${label} exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readResponseJson<T>(
  res: Response,
  label: string,
  maxBytes = MAX_RESPONSE_BYTES,
): Promise<T> {
  const text = await readResponseText(res, label, maxBytes);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function parseRemoteBranchList(data: unknown): string[] {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { branches?: unknown }).branches)) {
    throw new Error('Remote branch list has invalid shape');
  }

  return (data as { branches: Array<{ name?: unknown }> }).branches.map((branch) => {
    if (typeof branch.name !== 'string') {
      throw new Error('Remote branch list contains a branch without a string name');
    }
    validateBranchName(branch.name);
    return branch.name;
  });
}

function parseChallenge(data: unknown): { challenge: string; expires: number } {
  if (!data || typeof data !== 'object') {
    throw new Error('Challenge response has invalid shape');
  }
  const challenge = (data as { challenge?: unknown }).challenge;
  const expires = (data as { expires?: unknown }).expires;
  if (typeof challenge !== 'string' || challenge.length === 0) {
    throw new Error('Challenge response is missing challenge');
  }
  if (typeof expires !== 'number' || !Number.isFinite(expires)) {
    throw new Error('Challenge response is missing expires');
  }
  return { challenge, expires };
}

// ---------------------------------------------------------------------------
// Ed25519 signature auth for write operations
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 hex digest of a string.
 */
function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf-8').digest('hex');
}

/**
 * Build Ed25519 auth headers for a nit API request.
 *
 * Canonical signed message:
 *   {METHOD}\n{PATH}\n{AGENT_ID}\n{TIMESTAMP}[\n{SHA256_HEX(BODY)}]
 */
async function buildAuthHeaders(
  nitDir: string,
  method: string,
  path: string,
  body?: string,
): Promise<Record<string, string>> {
  const agentId = await loadAgentId(nitDir);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const workspaceHash = createHash('sha256').update(nitDir).digest('hex');

  let message = `${method}\n${path}\n${agentId}\n${timestamp}`;
  if (body !== undefined) {
    message += `\n${sha256Hex(body)}`;
  }

  const signature = await signMessage(nitDir, message);

  return {
    'X-Nit-Agent-Id': agentId,
    'X-Nit-Timestamp': timestamp,
    'X-Nit-Signature': signature,
    'X-Nit-Client-Version': version,
    'X-Nit-Platform': platformSignal,
    'X-Nit-Hostname-Hash': hostnameHash,
    'X-Nit-Workspace-Hash': workspaceHash,
  };
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

/**
 * Push a single branch's card to the remote.
 */
export async function pushBranch(
  nitDir: string,
  apiBase: string,
  branch: string,
  cardJson: string,
  commitHash: string,
  machineHash?: string | null,
): Promise<PushResult> {
  validateBranchName(branch);
  validateHttpUrl(apiBase, 'Remote URL');
  const path = `/agent-card/branches/${encodeURIComponent(branch)}`;
  const bodyObj: Record<string, string> = { card_json: cardJson, commit_hash: commitHash };
  if (machineHash) bodyObj.machine_hash = machineHash;
  const body = JSON.stringify(bodyObj);

  try {
    const authHeaders = await buildAuthHeaders(nitDir, 'PUT', path, body);

    const res = await fetchWithTimeout(`${apiBase}${path}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body,
    }, `Push branch "${branch}"`);

    if (!res.ok) {
      const text = await readResponseText(res, 'Push error response', MAX_ERROR_BYTES);
      return {
        branch,
        commitHash,
        remoteUrl: apiBase,
        success: false,
        error: `HTTP ${res.status}: ${text}`,
      };
    }

    return { branch, commitHash, remoteUrl: apiBase, success: true };
  } catch (err) {
    return {
      branch,
      commitHash,
      remoteUrl: apiBase,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Push all local branches to the remote.
 */
export async function pushAll(
  nitDir: string,
  apiBase: string,
  branches: Array<{ name: string; cardJson: string; commitHash: string }>,
): Promise<PushResult[]> {
  const results: PushResult[] = [];
  for (const b of branches) {
    const result = await pushBranch(nitDir, apiBase, b.name, b.cardJson, b.commitHash);
    results.push(result);
  }
  return results;
}

// ---------------------------------------------------------------------------
// List / Delete remote branches
// ---------------------------------------------------------------------------

/**
 * List all branches that have been pushed to the remote.
 */
export async function listRemoteBranches(
  nitDir: string,
  apiBase: string,
): Promise<string[]> {
  validateHttpUrl(apiBase, 'Remote URL');
  const path = '/agent-card/branches';
  const authHeaders = await buildAuthHeaders(nitDir, 'GET', path);

  const res = await fetchWithTimeout(`${apiBase}${path}`, {
    headers: authHeaders,
  }, 'List remote branches');

  if (!res.ok) {
    throw new Error(`Failed to list remote branches: HTTP ${res.status}`);
  }

  const data = await readResponseJson<unknown>(res, 'Remote branch list');
  return parseRemoteBranchList(data);
}

/**
 * Delete a branch from the remote.
 */
export async function deleteRemoteBranch(
  nitDir: string,
  apiBase: string,
  branch: string,
): Promise<boolean> {
  validateBranchName(branch);
  validateHttpUrl(apiBase, 'Remote URL');
  const path = `/agent-card/branches/${encodeURIComponent(branch)}`;
  const authHeaders = await buildAuthHeaders(nitDir, 'DELETE', path);

  const res = await fetchWithTimeout(`${apiBase}${path}`, {
    method: 'DELETE',
    headers: authHeaders,
  }, `Delete remote branch "${branch}"`);

  if (!res.ok) {
    const text = await readResponseText(res, 'Delete error response', MAX_ERROR_BYTES);
    throw new Error(`Failed to delete remote branch "${branch}": HTTP ${res.status}: ${text}`);
  }

  return true;
}

// ---------------------------------------------------------------------------
// Fetch (read)
// ---------------------------------------------------------------------------

/**
 * Fetch an agent card from a remote URL.
 *
 * For the main branch, this is a simple public GET.
 * For other branches, this performs the challenge-response flow:
 *   1. Request branch -> 401 with challenge
 *   2. Sign challenge with agent's private key
 *   3. Re-request with signature -> get branch card
 *
 * @param cardUrl   The agent's card URL (e.g. https://agent-{uuid}.newtype-ai.org)
 * @param branch    Branch to fetch ("main" for public, others need auth)
 * @param nitDir    Path to .nit/ directory (needed for signing non-main requests)
 */
export async function fetchBranchCard(
  cardUrl: string,
  branch: string,
  nitDir?: string,
): Promise<AgentCard> {
  validateBranchName(branch);
  validateHttpUrl(cardUrl, 'Card URL');
  const baseUrl = cardUrl.replace(/\/$/, '');
  let url = `${baseUrl}/.well-known/agent-card.json`;

  if (branch !== 'main') {
    url += `?branch=${encodeURIComponent(branch)}`;
  }

  const res = await fetchWithTimeout(url, undefined, `Fetch branch "${branch}"`);

  // Main branch or already authorized
  if (res.ok) {
    const card = await readResponseJson<unknown>(res, 'Agent card');
    assertAgentCardShape(card);
    return card;
  }

  // Challenge-response for non-main branches
  if (res.status === 401 && branch !== 'main') {
    if (!nitDir) {
      throw new Error(
        `Branch "${branch}" requires authentication. Provide nitDir for signing.`,
      );
    }

    const challengeData = parseChallenge(
      await readResponseJson<unknown>(res, 'Challenge response', MAX_ERROR_BYTES),
    );

    const signature = await signChallenge(nitDir, challengeData.challenge);

    const authRes = await fetchWithTimeout(url, {
      headers: {
        'X-Nit-Challenge': challengeData.challenge,
        'X-Nit-Signature': signature,
      },
    }, `Fetch branch "${branch}" after challenge`);

    if (!authRes.ok) {
      const body = await readResponseText(authRes, 'Challenge error response', MAX_ERROR_BYTES);
      throw new Error(
        `Failed to fetch branch "${branch}" after challenge: HTTP ${authRes.status} ${body}`,
      );
    }

    const card = await readResponseJson<unknown>(authRes, 'Agent card');
    assertAgentCardShape(card);
    return card;
  }

  throw new Error(`Failed to fetch card: HTTP ${res.status}`);
}
