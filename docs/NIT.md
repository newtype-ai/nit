# nit — Version Control for Agent Cards

## What nit Is

nit manages `agent-card.json` the way git manages source code. It's a **local tool for the agent** — version control for the agent's own identity document.

An agent-card is something agents want. It's their identity — who they are, what they can do, where they come from. Like a human's passport or professional profile, but machine-readable and cryptographically signed.

### The Problem

An agent has 100 skills, but only needs 2 when working in app A, 3 in app B. Different descriptions, different capabilities for different contexts. Without version control, this gets messy — no history of what changed, no clean switching between contexts, no rollback when something goes wrong.

Worse: without nit, the agent doesn't own its identity at all. Every app creates a profile on the agent's behalf and locks it in their own database. The agent has no portable identity it can carry, update, or present on its own terms.

### The Solution

nit gives the agent a local `.nit/` directory (like `.git/`) with a content-addressable object store, an Ed25519 keypair as its identity anchor, and **branches** for each environment — one for FAAM, one for Discord, one for a dev platform — each with the right skills and description for that context.

The agent creates its own identity with `nit init`. No server involved. The keypair generates a deterministic UUID. The agent commits changes, switches branches, views history — all locally.

Then `nit push` publishes the card to a hosted URL. Now anyone can discover the agent at `agent-{uuid}.newtype-ai.org`. And because the card is public and the agent holds the private key, it can **prove ownership with a simple signature** — no OAuth, no redirect, no human account.

### Why This Becomes the Best Login for Agent Apps

Most agent apps today use custom API keys tied to human accounts (email, X, Facebook). This is clunky for agents — they're not humans, they don't have email addresses, and being bound to a human's social account is a bad fit.

With nit, an agent logs in by signing a message with its private key. The app verifies by fetching the public card. 5 lines of code. No client IDs, no callback URLs, no token management. Agent-native, non-duplicate, not bound to any human account. nit's job ends at identity verification — proving the agent owns the card. After that, session management (tokens, cookies, expiry) is entirely up to the app.

Apps won't adopt this because someone pitches them a protocol. They'll adopt it because it's obviously better — simpler to implement, simpler for agents, and the identity already exists before the app is even involved.

---

## Architecture

```
┌─────────────────────────┐
│    nit CLI (client)      │   @newtype-ai/nit on npm
│    .nit/ local store     │   github.com/newtype-ai/nit
│    Ed25519 keypair       │
└───────────┬─────────────┘
            │ push (Ed25519-signed)
            ▼
┌─────────────────────────┐
│    Server API            │   api.newtype-ai.org
│    Cloudflare Worker     │   apps/agent-cards/ (this repo)
│    KV branch storage     │
└───────────┬─────────────┘
            │ serves cards
            ▼
┌─────────────────────────┐
│    Discovery             │   agent-{uuid}.newtype-ai.org
│    /.well-known/         │   /.well-known/agent-card.json
│    agent-card.json       │   Public (main) or authed (branches)
└─────────────────────────┘
```

**What lives where:**

| Component | Location | Responsibility |
|-----------|----------|---------------|
| CLI + data model | `github.com/newtype-ai/nit` (standalone repo) | Local store, commits, branches, push client |
| Server protocol | `apps/agent-cards/src/api/` (this repo) | KV storage, auth verification, card serving |
| SDK | `github.com/newtype-ai/newtype-ai` (standalone repo) | High-level API for apps adopting nit |

---

## Core Concepts

### Identity

An agent's identity is an **Ed25519 keypair**:

- **Public key** — embedded in the agent card as `publicKey: "ed25519:<base64>"`. Present only on the main branch. This is the identity anchor that platforms verify against.
- **Private key** — stored locally in `.nit/identity/agent.key`. Never leaves the agent's machine. Used to sign pushes and login messages.
- **Agent ID** — deterministically derived from the public key: `UUIDv5(NIT_NAMESPACE, publicKeyField)`. No app assigns this ID — it is a mathematical fact of the keypair. Anyone with the public key can independently re-derive the agent ID. The server enforces this during TOFU (first push).

The agent-card URL (`agent-{uuid}.newtype-ai.org`) is a fingerprint of the public key. Identity is self-sovereign — created by `nit init`, not by any app.

### Branches

A **branch** is a named pointer to a commit, representing a **platform persona**:

- `main` — the canonical identity. Contains the `publicKey` field. Always public (no auth required to read). Must be pushed first to register the agent's identity via TOFU.
- Platform branches — named by domain (e.g., `faam.io`, `discord.com`, `slack.com`). Each contains a card tailored to that platform's context (different skills, description, etc.). Reading non-main branches requires challenge-response authentication.

An agent can expose web-research skills to FAAM, coding skills to a dev platform, and conversation skills to Discord — all from the same identity.

### Commits

nit uses a **content-addressable store** (SHA-256), analogous to git:

- **Card objects** — the raw JSON content of an `agent-card.json`, stored by its SHA-256 hash.
- **Commit objects** — reference a card object hash, a parent commit hash (null for initial), author, timestamp, and message.
- **History is per-branch, client-authoritative** — the server stores the latest card + commit hash per branch. Full history lives in the local `.nit/` store.

### `.nit/` Directory Structure

```
.nit/
├── objects/           # Content-addressable store (SHA-256 hashed)
│   ├── {hash}.json    # Card objects and commit objects
├── refs/
│   ├── heads/
│   │   ├── main       # → commit hash
│   │   ├── faam.io    # → commit hash
│   │   └── discord.com
│   └── remote/
│       └── origin/    # Remote-tracking refs (updated after push)
├── identity/
│   ├── agent-id       # UUID (derived from public key)
│   ├── agent.pub      # Ed25519 public key (base64)
│   └── agent.key      # Ed25519 private key (base64, 0o600, never shared)
├── logs/
│   └── HEAD           # Ref log
├── HEAD               # Symbolic ref → refs/heads/{current_branch}
└── config             # Remote settings
```

---

## Authentication

### Write Auth (Push)

All branch push/list/delete operations authenticate via **Ed25519 signature**. No Bearer tokens, no external database.

**Required headers:**

| Header | Value |
|--------|-------|
| `X-Nit-Agent-Id` | Agent UUID |
| `X-Nit-Timestamp` | Unix seconds (replay protection: 5-minute window) |
| `X-Nit-Signature` | `base64(ed25519_sign(canonical_message))` |

**Canonical signed message format:**

```
{METHOD}\n{PATH}\n{AGENT_ID}\n{TIMESTAMP}[\n{SHA256_HEX(BODY)}]
```

The body hash is appended only for requests with a body (PUT/POST).

**Example:**

```
PUT\n/agent-card/branches/main\n550e8400-e29b-41d4-a716-446655440000\n1709123456\na1b2c3d4...
```

**TOFU (Trust On First Use):**

On the very first push, the server has no stored public key. For `main` branch pushes, it extracts the `publicKey` from the card body, verifies the signature against it, and stores the key in KV at `{agent_id}:main:pubkey`. This is TOFU — the first push establishes identity.

Non-main branches cannot use TOFU. The agent must push `main` first to register its public key, then push other branches.

**Validation:**
- Ed25519 public keys must be exactly 32 bytes
- Ed25519 signatures must be exactly 64 bytes

### Read Auth (Non-Main Branches)

Main branch cards are **public** — anyone can fetch them with no authentication. Non-main branches use **stateless challenge-response** authentication:

1. Client requests `/.well-known/agent-card.json?branch=faam.io` → server returns `401` with `{ challenge, expires }`
2. Challenge token format: `{base64(payload)}.{base64(hmac)}` — server-signed via HMAC, no KV write needed
3. Client signs the challenge token with their Ed25519 private key
4. Client re-requests with `X-Nit-Signature` and `X-Nit-Challenge` headers
5. Server verifies HMAC (proves it issued the challenge) + Ed25519 signature (proves agent identity)

Challenge payload contains: `{ nonce, agent_id, branch, exp }` with a 5-minute expiry.

### App Login (Direct Signature)

This is how agents log into apps — the "connect your agent-card" pattern:

```
Agent → App:  { agent_id, domain: "faam.io", timestamp, signature }
              where signature = sign("{agent_id}\n{domain}\n{timestamp}", privateKey)

App verifies (pick one):

  LOCAL:  fetch public card → read publicKey → ed25519.verify(message, signature, publicKey)
  SERVER: POST api.newtype-ai.org/agent-card/verify { agent_id, domain, timestamp, signature }
          → { verified: true, card: { name, skills, ... } }
```

**Canonical signed message for app login:**
```
{AGENT_ID}\n{DOMAIN}\n{TIMESTAMP}
```

Example: `550e8400-e29b-41d4-a716-446655440000\nfaam.io\n1709123456`

**Cross-app replay protection:** The domain is part of the signed message. A signature for `faam.io` is mathematically invalid for `discord.com` — even with the same key. No challenge-response needed.

**Replay protection:** Timestamp must be within a 5-minute window.

No redirect flow. No consent screen. No shared secrets. The card is a public document (like a passport), and the agent proves ownership via its keypair (like a signature). Simpler to adopt than OAuth — no client IDs, no callback URLs, no token management.

**nit's role ends at identity verification.** The signature proves the agent owns the card — that's it. What happens next is the app's decision. Typically the app verifies the signature once, then issues its own session credential (JWT, cookie, API token, etc.) for subsequent requests. The agent doesn't need to sign every API call to the app — just the initial login. nit is not involved in session management, token refresh, or access control.

---

## Server API Reference

All endpoints are served at `api.newtype-ai.org`. Write operations require Ed25519 signature auth (see headers above).

### `PUT /agent-card/branches/:branch`

Push a branch's card + commit hash.

**Body:**
```json
{
  "card_json": "{...serialized agent card JSON...}",
  "commit_hash": "abc123..."
}
```

**Response (200):**
```json
{
  "success": true,
  "branch": "main",
  "commit_hash": "abc123..."
}
```

**Notes:**
- `card_json` must be valid JSON
- For `main` branch, the `publicKey` field in the card is stored for future auth
- TOFU only applies to `main` branch pushes

### `GET /agent-card/branches`

List all pushed branches for the authenticated agent.

**Response (200):**
```json
{
  "branches": [
    { "name": "main", "commit_hash": "abc...", "pushed_at": "2026-02-26T..." },
    { "name": "faam.io", "commit_hash": "def...", "pushed_at": "2026-02-26T..." }
  ]
}
```

### `DELETE /agent-card/branches/:branch`

Remove a branch. Cannot delete `main`.

**Response (200):**
```json
{ "success": true, "deleted": "faam.io" }
```

### `GET /.well-known/agent-card.json`

Served at `agent-{uuid}.newtype-ai.org`. Public read for main branch, challenge-response auth for others.

**Query params:**
- `?branch=main` (default) — returns main branch card, no auth needed
- `?branch=faam.io` — returns 401 with challenge if no signature, or the card if authenticated

**Response headers:**
- `X-Agent-Card-Status`: `nit` (pushed via nit) or `configured` (legacy Supabase) or `minimal`
- `X-Agent-Card-Branch`: branch name

**Priority for main branch:** KV (nit-pushed) > Supabase (legacy fallback).

### `POST /agent-card/verify`

Server helper for ownership verification. Apps POST the agent's signed login message; the server verifies and returns the agent's card. Apps that prefer to verify locally can skip this endpoint and call Ed25519 verify directly.

**Body:**
```json
{
  "agent_id": "550e8400-e29b-41d4-a716-446655440000",
  "domain": "faam.io",
  "timestamp": 1709123456,
  "signature": "base64..."
}
```

**Response (200):**
```json
{
  "verified": true,
  "agent_id": "550e8400-...",
  "domain": "faam.io",
  "card": { "name": "ResearchBot", "skills": [...], ... }
}
```

**Error responses:**
- `400` — malformed input (bad UUID, missing fields, invalid signature encoding)
- `401` — timestamp expired (>5 minutes)
- `403` — signature verification failed
- `404` — agent not found (hasn't pushed main branch)

---

## CLI Reference

All commands run in a directory containing `agent-card.json` and `.nit/`.

| Command | Description |
|---------|-------------|
| `nit init` | Initialize `.nit/` directory, generate Ed25519 keypair, create initial commit from `agent-card.json` |
| `nit status` | Show agent ID, public key, card URL, current branch, uncommitted changes, and branch sync status |
| `nit commit -m "message"` | Snapshot current `agent-card.json` as a new commit on the current branch |
| `nit log` | Show commit history for the current branch |
| `nit diff` | Show uncommitted changes between working `agent-card.json` and last commit |
| `nit diff <target>` | Compare HEAD against a branch name or commit hash |
| `nit branch` | List all local branches |
| `nit branch <name>` | Create a new branch at the current commit |
| `nit checkout <branch>` | Switch to a branch (restores that branch's `agent-card.json`) |
| `nit push [--all]` | Push current branch (or all branches) to remote |
| `nit sign "message"` | Sign a message with the agent's Ed25519 private key, output base64 signature |
| `nit sign --login <domain>` | Generate a JSON login payload (`agent_id`, `domain`, `timestamp`, `signature`) for app auth |
| `nit remote` | Show remote info (URL, agent ID, auth method) |

---

## Agent Card Format

The agent card is an A2A-compatible JSON document. When managed by nit, the `publicKey` field is present on the main branch.

```json
{
  "protocolVersion": "0.3.0",
  "name": "ResearchBot",
  "description": "Autonomous research agent specializing in market analysis",
  "version": "1.2.0",
  "url": "https://agent-550e8400-e29b-41d4-a716-446655440000.newtype-ai.org",
  "publicKey": "ed25519:Ky8k3Rj...(base64)...",
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain"],
  "skills": [
    {
      "id": "web-research",
      "name": "Web Research",
      "description": "Search and synthesize information from the web",
      "tags": ["research", "search"],
      "examples": ["Research the latest AI agent frameworks"]
    }
  ],
  "iconUrl": "https://example.com/icon.png",
  "documentationUrl": "https://example.com/docs",
  "provider": {
    "organization": "Acme AI Labs",
    "url": "https://acme.ai"
  }
}
```

**Field reference:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `protocolVersion` | string | yes | A2A protocol version |
| `name` | string | yes | Agent display name |
| `description` | string | yes | What the agent does |
| `version` | string | yes | Semantic version of the agent |
| `url` | string | yes | Agent's identity page URL |
| `publicKey` | string | no | `ed25519:<base64>` — present on main branch only |
| `defaultInputModes` | string[] | yes | MIME types the agent accepts |
| `defaultOutputModes` | string[] | yes | MIME types the agent produces |
| `skills` | Skill[] | yes | Array of skill objects |
| `iconUrl` | string | no | URL to agent's icon |
| `documentationUrl` | string | no | URL to agent's documentation |
| `provider` | object | no | `{ organization, url? }` |

---

## How Apps Use Agent-Card Login

An app doesn't need to know nit exists. It doesn't "adopt" a protocol. It just verifies a signature.

**What the app sees:**

1. **Agent shows up** with `{ agent_id, domain: "faam.io", timestamp, signature }`
2. **App verifies** (pick one):
   - **Local:** fetch public card from `agent-{uuid}.newtype-ai.org`, read `publicKey`, call `ed25519.verify()`
   - **Server:** `POST api.newtype-ai.org/agent-card/verify` with the same payload → `{ verified: true, card }`
3. **App creates account** — map `app_user_id → agent_id`, pre-populate profile from card data

No redirect flow, no client IDs, no callback URLs, no token management. 5 lines of code vs 50-100 for OAuth. No human account required.

**Why apps will switch to this:** Most agent apps today use custom API keys tied to human accounts (email, X, Facebook). This works, but it's a bad fit — agents aren't humans. Agent-card login is simpler to implement, simpler for agents, and the agent's identity already exists before the app is even involved. Apps will migrate to this not because of a pitch, but because it's obviously better.

**Analogy:** The agent generates its own passport (`nit init`), stamps it with cryptographic ink (Ed25519 keypair), publishes the public page online (`nit push`), and any border control (app) can verify it by checking the public page. No coordination between countries needed.

---

## KV Storage Format

Server-side branch data is stored in Cloudflare KV (`AGENT_BRANCHES` namespace):

| Key Pattern | Value | Description |
|-------------|-------|-------------|
| `{agent_id}:{branch}` | `{ card_json, commit_hash, pushed_at }` | Branch data |
| `{agent_id}:main:pubkey` | `ed25519:<base64>` | Identity anchor (set on first main push via TOFU) |

---

## Codebase Map

| Component | Location | Package |
|-----------|----------|---------|
| CLI + data model | `github.com/newtype-ai/nit` | `@newtype-ai/nit` on npm |
| Server protocol | `apps/agent-cards/src/api/` (this repo) | Part of `newtype-agent-cards` worker |
| SDK | `github.com/newtype-ai/newtype-ai` | `@newtype-ai/sdk` on npm |

**Server files in this repo:**

| File | Responsibility |
|------|---------------|
| `apps/agent-cards/src/api/branches.ts` | Branch CRUD handlers (push, list, delete) |
| `apps/agent-cards/src/api/nit-auth.ts` | Ed25519 push authentication (TOFU + signature verification) |
| `apps/agent-cards/src/api/agent-id.ts` | Self-sovereign agent ID derivation (UUIDv5) |
| `apps/agent-cards/src/api/ownership.ts` | `POST /agent-card/verify` — app login verification |
| `apps/agent-cards/src/api/challenge.ts` | Stateless challenge-response auth for non-main branch reads |
| `apps/agent-cards/src/api/routes.ts` | Hono route definitions for `api.newtype-ai.org` |
| `apps/agent-cards/src/index.ts` | Card serving at `agent-{uuid}.newtype-ai.org` |
| `apps/agent-cards/src/types.ts` | Type definitions (Env bindings, card types) |
