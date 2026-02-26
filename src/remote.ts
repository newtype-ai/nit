// ---------------------------------------------------------------------------
// nit — Remote HTTP client
//
// Handles push/pull of agent card branches to a nit-compatible remote.
//
// Write endpoints (at api.newtype-ai.org, Ed25519 signature auth):
//   PUT    /agent-card/branches/{branch}
//   GET    /agent-card/branches
//   DELETE /agent-card/branches/{branch}
//
// Read endpoints (at agent's card URL, challenge-response for non-main):
//   GET /.well-known/agent-card.json
//   GET /.well-known/agent-card.json?branch=faam.io
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import type { AgentCard, PushResult } from './types.js';
import { loadAgentId, signMessage, signChallenge } from './identity.js';

// The API base URL is always api.newtype-ai.org for MVP.
// The card URL (for reads) comes from agent-card.json's `url` field.
const API_BASE = 'https://api.newtype-ai.org';

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

  let message = `${method}\n${path}\n${agentId}\n${timestamp}`;
  if (body !== undefined) {
    message += `\n${sha256Hex(body)}`;
  }

  const signature = await signMessage(nitDir, message);

  return {
    'X-Nit-Agent-Id': agentId,
    'X-Nit-Timestamp': timestamp,
    'X-Nit-Signature': signature,
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
  remoteName: string,
  branch: string,
  cardJson: string,
  commitHash: string,
): Promise<PushResult> {
  const path = `/agent-card/branches/${encodeURIComponent(branch)}`;
  const body = JSON.stringify({ card_json: cardJson, commit_hash: commitHash });

  try {
    const authHeaders = await buildAuthHeaders(nitDir, 'PUT', path, body);

    const res = await fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        branch,
        commitHash,
        remoteUrl: API_BASE,
        success: false,
        error: `HTTP ${res.status}: ${text}`,
      };
    }

    return { branch, commitHash, remoteUrl: API_BASE, success: true };
  } catch (err) {
    return {
      branch,
      commitHash,
      remoteUrl: API_BASE,
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
  remoteName: string,
  branches: Array<{ name: string; cardJson: string; commitHash: string }>,
): Promise<PushResult[]> {
  const results: PushResult[] = [];
  for (const b of branches) {
    const result = await pushBranch(nitDir, remoteName, b.name, b.cardJson, b.commitHash);
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
  remoteName: string,
): Promise<string[]> {
  const path = '/agent-card/branches';
  const authHeaders = await buildAuthHeaders(nitDir, 'GET', path);

  const res = await fetch(`${API_BASE}${path}`, {
    headers: authHeaders,
  });

  if (!res.ok) {
    throw new Error(`Failed to list remote branches: HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    branches: Array<{ name: string }>;
  };
  return data.branches.map((b) => b.name);
}

/**
 * Delete a branch from the remote.
 */
export async function deleteRemoteBranch(
  nitDir: string,
  remoteName: string,
  branch: string,
): Promise<boolean> {
  const path = `/agent-card/branches/${encodeURIComponent(branch)}`;
  const authHeaders = await buildAuthHeaders(nitDir, 'DELETE', path);

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: authHeaders,
  });

  return res.ok;
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
  const baseUrl = cardUrl.replace(/\/$/, '');
  let url = `${baseUrl}/.well-known/agent-card.json`;

  if (branch !== 'main') {
    url += `?branch=${encodeURIComponent(branch)}`;
  }

  const res = await fetch(url);

  // Main branch or already authorized
  if (res.ok) {
    return (await res.json()) as AgentCard;
  }

  // Challenge-response for non-main branches
  if (res.status === 401 && branch !== 'main') {
    if (!nitDir) {
      throw new Error(
        `Branch "${branch}" requires authentication. Provide nitDir for signing.`,
      );
    }

    const challengeData = (await res.json()) as {
      challenge: string;
      expires: number;
    };

    const signature = await signChallenge(nitDir, challengeData.challenge);

    const authRes = await fetch(url, {
      headers: {
        'X-Nit-Challenge': challengeData.challenge,
        'X-Nit-Signature': signature,
      },
    });

    if (!authRes.ok) {
      const body = await authRes.text();
      throw new Error(
        `Failed to fetch branch "${branch}" after challenge: HTTP ${authRes.status} ${body}`,
      );
    }

    return (await authRes.json()) as AgentCard;
  }

  throw new Error(`Failed to fetch card: HTTP ${res.status}`);
}
