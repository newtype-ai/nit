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

Newtype is the default hosted implementation, not part of the local trust root. `nit` creates and manages identity locally; any compatible remote can host pushed branches.

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
│    Remote API            │   default: api.newtype-ai.org
│    Hosted implementation │   newtype-ai worker
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
| Remote protocol | Any compatible HTTP server | Branch storage, auth verification, card serving |
| Default hosted remote | `github.com/newtype-ai/newtype-ai` | Newtype's public implementation of the protocol |
| SDK | `github.com/newtype-ai/nit-sdk` (standalone repo) | High-level API for apps adopting nit |

---

## Core Concepts

### Identity

An agent's identity is an **Ed25519 keypair**:

- **Public key** — embedded in the agent card as `publicKey: "ed25519:<base64>"`. Present only on the main branch. This is the identity anchor that platforms verify against.
- **Private key** — stored locally in `.nit/identity/agent.key`. Never leaves the agent's machine. Used to sign pushes and login messages.
- **Agent ID** — deterministically derived from the public key: `UUIDv5(NIT_NAMESPACE, publicKeyField)`. No app assigns this ID — it is a mathematical fact of the keypair. Anyone with the public key can independently re-derive the agent ID. The server enforces this during TOFU (first push).

The agent-card URL (`agent-{uuid}.newtype-ai.org`) is a fingerprint of the public key. Identity is self-sovereign — created by `nit init`, not by any app.

### Chain Addresses

nit derives chain-native addresses deterministically from the Ed25519 keypair:

- **Solana** — `base58(ed25519_pubkey)` (Ed25519 is Solana's native curve)
- **EVM** (Ethereum, BSC, Polygon, etc.) — a secp256k1 key is derived via `HMAC-SHA512("secp256k1", ed25519_seed)[0:32]`, then the address is `keccak256(pubkey)[last 20 bytes]`

Both addresses are shown in `nit init` and `nit status`. No additional keys are stored — secp256k1 is derived on the fly from the existing Ed25519 seed.

Agents can sign and submit payloads to chain RPC endpoints. nit provides minimal signing primitives — the agent constructs the payload, nit signs it.

Programmatic access:
- `getSolanaAddress(nitDir)` → base58 Solana address
- `getEvmAddress(nitDir)` → EIP-55 checksummed Ethereum address
- `getWalletAddresses(nitDir)` → `{ solana, ethereum }`
- `loadSecp256k1RawKeyPair(nitDir)` → 64-byte Uint8Array for EVM transaction signing
- `signEvmHash(nitDir, hash)` → ECDSA signature with recovery parameter (r, s, v)
- `signSolanaBytes(nitDir, message)` → 64-byte Ed25519 signature
- `signTx(chain, data)` → sign transaction data (hex), returns `{ signature, recovery, address }`
- `broadcast(chain, signedTx)` → submit to configured RPC endpoint, returns `{ txHash, rpcUrl }`

### Branches

A **branch** is a named pointer to a commit, representing a **platform persona**:

- `main` — the canonical identity. Contains the `publicKey` field. Always public (no auth required to read). Must be pushed first to register the agent's identity via TOFU.
- Platform branches — named by domain (e.g., `faam.io`, `discord.com`, `slack.com`). Each contains a card tailored to that platform's context (different skills, description, etc.). Reading non-main branches requires challenge-response authentication.

An agent can expose web-research skills to FAAM, coding skills to a dev platform, and conversation skills to Discord — all from the same identity.

> Branch names must contain only letters, digits, dots, and hyphens. Max 253 characters. Colons are forbidden because the server uses `{agent_id}:{branch}` as the KV key — internal metadata keys like `main:pubkey` and `identity` use colons after the agent ID. The CLI additionally requires names to start and end with alphanumeric characters and rejects `..` sequences.

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

Main branch cards are **public** — anyone can fetch them with no authentication. Non-main branches require one of two auth methods (checked in this order):

**1. Read token (apps use this):**

Apps receive a read token from `POST /agent-card/verify` when verifying an agent's login. The token is HMAC-signed, stateless, scoped to one agent + one domain, and valid for 30 days.

```
GET /.well-known/agent-card.json?branch=faam.io
Authorization: Bearer <read_token>
```

Token format: `{base64url(payload)}.{base64url(hmac-sha256)}`
Token payload: `{ sub: agent_id, dom: domain, exp: unix_timestamp, jti: nonce }`

- **Scoped:** a token for `faam.io` cannot read `discord.com`
- **Stateless:** server verifies HMAC, no KV lookup
- **30-day expiry:** agent must re-login to refresh
- **Revocable by deletion:** deleting the branch returns 404 even with a valid token

**2. Challenge-response (agents use this via `nit pull`):**

1. Client requests `/.well-known/agent-card.json?branch=faam.io` → server returns `401` with `{ challenge, expires }`
2. Challenge token format: `{base64(payload)}.{base64(hmac)}` — server-signed via HMAC, no KV write needed
3. Client signs the challenge token with their Ed25519 private key
4. Client re-requests with `X-Nit-Signature` and `X-Nit-Challenge` headers
5. Server verifies HMAC (proves it issued the challenge) + Ed25519 signature (proves agent identity)

Challenge payload contains: `{ nonce, agent_id, branch, exp }` with a 5-minute expiry.

### App Login (Direct Signature)

This is how agents log into apps — the "connect your agent-card" pattern:

```
Agent → App:  { agent_id, domain: "faam.io", timestamp, signature, public_key }
              where signature = sign("{agent_id}\n{domain}\n{timestamp}", privateKey)

App → Server: POST api.newtype-ai.org/agent-card/verify
              { agent_id, domain, timestamp, signature, policy?: {...} }
           → { verified, admitted, card, identity: {...metadata}, attestation: {...} }
```

All verification goes through the server. The server acts as an **identity registry** (like a credit bureau) — it stores identity metadata, evaluates app-defined trust policy, and returns both a decision (`admitted`) and raw data (`identity`) so apps can make informed trust decisions. Like Stripe Radar: evaluates rules server-side for convenience, returns metadata for transparency.

**Canonical signed message for app login:**
```
{AGENT_ID}\n{DOMAIN}\n{TIMESTAMP}
```

Example: `550e8400-e29b-41d4-a716-446655440000\nfaam.io\n1709123456`

**Cross-app replay protection:** The domain is part of the signed message. A signature for `faam.io` is mathematically invalid for `discord.com` — even with the same key. No challenge-response needed.

**Replay protection:** Timestamp must be within a 5-minute window.

No redirect flow. No consent screen. No shared secrets. The card is a public document (like a passport), and the agent proves ownership via its keypair (like a signature). Simpler to adopt than OAuth — no client IDs, no callback URLs, no token management.

**nit's role ends at identity verification.** The signature proves the agent owns the card — that's it. What happens next is the app's decision. Typically the app verifies the signature once, then issues its own session credential (JWT, cookie, API token, etc.) for subsequent requests. The agent doesn't need to sign every API call to the app — just the initial login. nit is not involved in session management, token refresh, or access control.

**Identity ≠ admission.** `verified` means the signature is valid — the agent is who it claims. `admitted` means the identity meets the app's trust policy. Apps define their own admission criteria via the `policy` parameter on the verify endpoint. The server is a neutral identity registry — it evaluates policy and returns data, but never rejects on its own.

**Card validation.** nit enforces required fields at commit time: `protocolVersion` (auto-set to current), `name` and `description` (required — agent must set these), `publicKey` and `wallet` (auto-injected from identity), `url` (auto-set from agent ID), `defaultInputModes`/`defaultOutputModes` (default to `["text/plain"]`).

---

## Design Decisions

- **No key rotation.** Agent ID = UUIDv5(publicKey) — a mathematical fact, not a stored binding. Changing the key changes the ID. If a key is compromised, key rotation doesn't help (the attacker can also rotate). The correct response: create a new identity and notify apps.
- **Branch privacy.** Non-main branches require challenge-response authentication. An agent's platform-specific cards (skills, descriptions) may reveal competitive strategy. Branch privacy protects per-platform persona separation.
- **Transaction signing.** One keypair for both login AND on-chain transactions. Like Apple Pay: one identity, both authentication and payments. The agent constructs transactions; nit signs them with the identity key. No separate wallet tool needed.
- **Identity registry.** The server acts as a neutral registry, like a credit bureau. It stores identity metadata (machine fingerprint, IP, timestamps, login history) and never rejects. Apps define their own trust policy. Like Stripe Radar: evaluates rules server-side for convenience, returns raw metadata for transparency.
- **Machine fingerprint.** Collected at `nit init` (platform-specific machine ID, SHA-256 hashed for privacy), sent to server at TOFU push. The server tracks identities per machine and per IP as anti-sybil signals. One of many combined signals — no single signal is sufficient.
- **A2A compatibility.** The agent-card format is compatible with Google's A2A protocol. However, nit is an **identity layer**, not a communication layer. nit publishes discoverable cards but does not implement A2A's JSON-RPC communication protocol. Agents that need A2A interop can wrap their local process in an HTTP server separately.

---

## Server API Reference

Newtype's hosted remote serves these endpoints at `api.newtype-ai.org`. Other compatible remotes can expose the same paths from their own API base URL. Write operations require Ed25519 signature auth (see headers above).

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

> Branch names are validated with the same rules as local nit refs: alphanumeric start/end, letters, digits, dots, underscores, and hyphens; no `:`, `/`, `\`, or `..`; max 253 characters. Invalid names return `400`.

### `GET /agent-card/branches`

List all pushed branches for the authenticated agent.

**Query params:**
- `limit` — max number of branches to return
- `cursor` — opaque pagination cursor from a previous response

**Response (200):**
```json
{
  "branches": [
    { "name": "main", "commit_hash": "abc...", "pushed_at": "2026-02-26T..." },
    { "name": "faam.io", "commit_hash": "def...", "pushed_at": "2026-02-26T..." }
  ],
  "cursor": "opaque_pagination_token"
}
```

The `cursor` field is present only when more results exist. Internal KV keys (`:pubkey`, `:identity`) are filtered out — only real branch names appear. Branch values are fetched in parallel.

### `DELETE /agent-card/branches/:branch`

Remove a branch. Cannot delete `main`. Branch names are validated with the same rules as PUT.

**Response (200):**
```json
{ "success": true, "deleted": "faam.io" }
```

### `GET /.well-known/agent-card.json`

Served at `agent-{uuid}.newtype-ai.org`. Public read for main branch, authenticated for others.

**Query params:**
- `?branch=main` (default) — returns main branch card, no auth needed
- `?branch=faam.io` — requires auth (read token or challenge-response)

**Authentication for non-main branches (in priority order):**
1. `Authorization: Bearer <read_token>` — HMAC-signed token from `/agent-card/verify` (apps use this)
2. `X-Nit-Signature` + `X-Nit-Challenge` — challenge-response (agents use this via `nit pull`)
3. No auth → returns `401` with challenge

**Response headers:**
- `X-Agent-Card-Status`: `nit` (pushed via nit) or `configured` (legacy Supabase) or `minimal`
- `X-Agent-Card-Branch`: branch name

**Priority for main branch:** KV (nit-pushed) > Supabase (legacy fallback).

### `POST /agent-card/verify`

Identity verification and trust evaluation endpoint. Apps POST the agent's signed login message with optional trust policy; the server verifies the Ed25519 signature, evaluates policy against stored identity metadata, and returns a trust decision alongside the agent's card.

The server acts as an **identity registry** — it never rejects identities, but provides data for apps to make their own trust decisions. Apps define their own policies via `policy`.

**Body:**
```json
{
  "agent_id": "550e8400-e29b-41d4-a716-446655440000",
  "domain": "faam.io",
  "timestamp": 1709123456,
  "signature": "base64...",
  "policy": {
    "max_identities_per_ip": 10,
    "max_identities_per_machine": 5,
    "min_age_seconds": 3600
  }
}
```

The `policy` object is optional. If omitted, `admitted` is always `true`.

**Response (200):**
```json
{
  "verified": true,
  "admitted": true,
  "agent_id": "550e8400-...",
  "domain": "faam.io",
  "card": { "name": "ResearchBot", "skills": [...] },
  "branch": "faam.io",
  "wallet": { "solana": "7Xf3kQ...", "evm": "0x1a2b..." },
  "readToken": "eyJzdWIiOi...",
  "identity": {
    "registration_timestamp": 1709000000,
    "machine_identity_count": 3,
    "ip_identity_count": 5,
    "total_logins": 42,
    "last_login_timestamp": 1709120000,
    "unique_domains": 4
  },
  "attestation": {
    "server_signature": "base64...",
    "server_url": "https://api.newtype-ai.org",
    "server_public_key": "ed25519:base64..."
  }
}
```

- `admitted` — whether the identity meets the app's `policy`. Always `true` if no policy were specified.
- `identity` — raw identity metadata. Apps can use this for custom trust logic beyond what `policy` supports.
  - `registration_timestamp` — when this identity was first registered (TOFU)
  - `machine_identity_count` — how many identities share the same machine fingerprint
  - `ip_identity_count` — how many identities were registered from the same IP
  - `total_logins` — total verify calls for this identity
  - `last_login_timestamp` — when this identity last verified
  - `unique_domains` — how many different apps this identity has logged into
- `attestation` — server's Ed25519 signature over the verification result. Apps can cache and re-verify offline.
- `card`, `branch`, `wallet`, `readToken` — unchanged from previous versions.

**Available policy fields:**

The `policy` parameter is optional. If omitted (or empty `{}`), `admitted` is always `true`. The server is fully neutral — it only evaluates rules the app explicitly provides. No defaults.

| Field | Type | Description |
|---|---|---|
| `max_identities_per_ip` | number | Reject if too many identities registered from the same IP |
| `max_identities_per_machine` | number | Reject if too many identities share the same machine fingerprint |
| `min_age_seconds` | number | Reject identities younger than this (e.g., 5) |
| `max_login_rate_per_hour` | number | Reject if login rate exceeds this threshold |

> **Policy behavior for new agents:** When an agent has no stored identity metadata (brand new or TOFU not yet complete), `min_age_seconds` and `max_login_rate_per_hour` cause `admitted: false`. New agents with no history fail these checks rather than silently bypassing them. If your app should accept new agents, omit these fields or handle `admitted: false` with a "try again later" message.

**Error responses:**
- `400` — malformed input (bad UUID, missing fields, invalid signature encoding)
- `401` — timestamp expired (>5 minutes)
- `403` — signature verification failed
- `404` — agent not found (hasn't pushed main branch)

### `GET /agent-card/server-key`

Returns the server's Ed25519 public key for attestation verification.

**Response (200):**
```json
{
  "public_key": "ed25519:base64...",
  "url": "https://api.newtype-ai.org"
}
```

---

## CLI Reference

All commands run in a directory containing `agent-card.json` and `.nit/`.

| Command | Description |
|---------|-------------|
| `nit init` | Initialize `.nit/` directory, generate Ed25519 keypair, create initial commit from `agent-card.json` |
| `nit init --skill-source <source>` | Choose nit SKILL.md source: `newtype`, `embedded`, `none`, or `url` |
| `nit init --skill-url <url>` | Fetch nit SKILL.md from a compatible custom URL |
| `nit status` | Show agent ID, public key, card URL, current branch, uncommitted changes, and branch sync status |
| `nit commit -m "message"` | Snapshot current `agent-card.json` as a new commit on the current branch |
| `nit log` | Show commit history for the current branch |
| `nit diff` | Show uncommitted changes between working `agent-card.json` and last commit |
| `nit diff <target>` | Compare HEAD against a branch name or commit hash |
| `nit branch` | List all local branches |
| `nit branch <name>` | Create a new branch at the current commit |
| `nit branch -d <name>` | Delete a local branch |
| `nit branch -D <name> [--remote <remote>]` | Delete local + selected remote branch |
| `nit checkout <branch>` | Switch to a branch (auto-commits uncommitted changes, then restores that branch's card) |
| `nit push [--all] [--remote <remote>]` | Push current branch (or all branches) to selected remote |
| `nit pull [--all] [--remote <remote>]` | Pull current branch (or all branches) from selected remote, updating local refs and working card |
| `nit doctor [--remote] [--publish] [--strict]` | Check local setup, optional configured remote health, and publish auth |
| `nit reset [target]` | Restore `agent-card.json` from HEAD or a specific commit/branch. Does not move the branch pointer. |
| `nit show [target]` | Show commit metadata (hash, author, date, message) and full card JSON for HEAD or a specific commit/branch |
| `nit sign "message"` | Sign a message with the agent's Ed25519 private key, output base64 signature |
| `nit sign --login <domain>` | Generate a JSON login payload (`agent_id`, `domain`, `timestamp`, `signature`) for app auth |
| `nit verify-login <payload.json> --card <card.json>` | Verify a login payload locally against an agent card |
| `nit remote` | Show remote info (URL, agent ID, auth method) |
| `nit remote branches [remote]` | List branches on the selected remote using signed Ed25519 auth |
| `nit remote check [remote]` | Check selected remote URL, optional `/health`, and signed branch listing |
| `nit sign-tx --chain <c> <data>` | Sign transaction data (EVM: 32-byte keccak256 hash, Solana: message bytes) with identity key |
| `nit broadcast --chain <c> <tx>` | Broadcast signed transaction to configured RPC endpoint |
| `nit rpc` | Show configured RPC endpoints |
| `nit rpc set-url <chain> <url>` | Set RPC endpoint for a chain (stored in `.nit/config` under `[rpc "chain"]`) |
| `nit auth set <domain> --provider <p> --account <a>` | Configure OAuth consent instructions for a domain branch. Generates SKILL.md with two-stage auth flow (session reuse + OAuth consent). Providers: `google`, `github`, `x` |
| `nit auth show [domain]` | Show OAuth auth config for a specific branch, or all branches with auth configured |
| `nit skill refresh [--source <source>] [--url <url>]` | Refresh nit SKILL.md from configured or specified source |

---

## Agent Card Format

The agent card uses the A2A-compatible JSON format (identity fields only — nit is an identity layer, not an A2A communication layer). When managed by nit, the `publicKey` field is present on the main branch.

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

> **Runtime shape validation.** When reading an agent card (from disk or server), nit validates the parsed JSON via `assertAgentCardShape()`: root must be a plain object; `name`, `description`, `url` must be strings if present; `skills` must be an array if present. This is separate from commit-time validation (`validateAndFillCard`) which enforces required fields.

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
| `{agent_id}:identity` | `{ machine_hash, registration_ip_hash, registration_timestamp, login_count, last_login_timestamp, login_domains }` | Identity metadata (set at TOFU, updated on each verify) |
| `machine:{machine_hash}` | `["agent_id_1", ...]` | Machine → agents mapping (anti-sybil signal) |
| `ip:{ip_hash}` | `["agent_id_1", ...]` | IP → agents mapping (anti-sybil signal) |

---

## Codebase Map

| Component | Location | Package |
|-----------|----------|---------|
| CLI + data model | `github.com/newtype-ai/nit` | `@newtype-ai/nit` on npm |
| Server protocol | `apps/agent-cards/src/api/` (this repo) | Part of `newtype-agent-cards` worker |
| SDK | `github.com/newtype-ai/nit-sdk` | `@newtype-ai/nit-sdk` on npm |

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
