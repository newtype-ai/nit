# How nit Works — Complete Mechanism Guide

## Overview

nit gives AI agents self-sovereign cryptographic identity. One Ed25519 keypair → agent ID + signed identity document + wallet addresses. Local-first, version-controlled, anti-sybil.

---

## 1. Identity Creation (`nit init`)

**What happens:** Generate an Ed25519 keypair, derive a deterministic agent ID, create an identity document.

**Ed25519 keypair:**
- Node.js `crypto.generateKeyPairSync('ed25519')` → 32-byte public key + 32-byte private seed
- Same curve as SSH (`ssh-ed25519`), Signal protocol, and Solana
- Deterministic signatures (no nonce — unlike ECDSA, which broke Sony's PS3). 64-byte sigs, ~76K ops/sec

**Agent ID derivation:**
- Format: `UUIDv5(NIT_NAMESPACE, "ed25519:<base64_pubkey>")`
- Namespace: `801ba518-f326-47e5-97c9-d1efd1865a19` (hardcoded, shared with server)
- Process: SHA-1 hash of `namespace_bytes || name_bytes`, set version 5 + RFC 4122 variant bits
- Result: a UUID like `c33c378a-40f3-563a-89cd-68a454bb7583`
- **Key property:** anyone with the public key can independently derive the same agent ID. No server assigns it.

**What gets stored in `.nit/`:**
```
.nit/
├── identity/
│   ├── agent.pub     # base64(32-byte Ed25519 public key)
│   ├── agent.key     # base64(32-byte Ed25519 seed) — mode 0o600, never leaves machine
│   └── agent-id      # derived UUID
├── objects/           # SHA-256 content-addressable store
│   └── {hash[0:2]}/{hash[2:]}   # card and commit objects
├── refs/heads/main    # points to initial commit hash
├── HEAD               # "ref: refs/heads/main"
├── config             # INI: remote URL, skills dir, RPC endpoints
└── logs/HEAD          # (empty initially)
```

**The agent card (`agent-card.json`):**
- A2A-compatible JSON document: name, description, skills, version, url
- `publicKey: "ed25519:<base64>"` — injected automatically, present only on main branch
- `wallet: { solana: "...", evm: "..." }` — derived from keypair, injected at every commit
- Card URL: `https://agent-{uuid}.newtype-ai.org`

---

## 2. Content-Addressable Store

Every card version and every commit is stored as an immutable, hash-addressed object. Same model as git.

**Hashing:**
```
SHA-256("{type} {byteLength}\0{content}")
```
where type is `card` or `commit`. The null byte separates the header from the content.

**Storage:** Hash `a1b2c3d4...` → file at `.nit/objects/a1/b2c3d4...`

**Commit format:**
```
card {cardHash}
parent {parentHash}
author {name} {timestamp}

{message}
```
Parent is omitted for the initial commit. Timestamp is unix seconds.

**Why SHA-256 (not SHA-1 like git):** No legacy toolchain to maintain compatibility with. SHA-1 collision attacks have been practical since 2017 (SHAttered). New system = use the better hash.

---

## 3. Login Flow (`nit sign --login <domain>`)

**One command does everything.** If no `.nit/` exists: auto-init + auto-push + auto-branch + login.

**Step-by-step:**

1. **No `.nit/`?** → call `init()` (creates keypair, card, initial commit) → call `push()` (TOFU registration on server)

2. **Not on the domain branch?** → create branch from HEAD (if new) → auto-commit any uncommitted changes on current branch → checkout domain branch

3. **Fetch app's SKILL.md** → `GET https://{domain}/skill.md` (5s timeout). If remote has newer version (semver), update local copy. If offline or 404, use fallback template.

4. **Add skill pointer** to agent-card.json if not present

5. **Sign the login payload:**
   ```
   message = "{agent_id}\n{domain}\n{timestamp}"
   signature = ed25519_sign(message, private_key)
   ```

6. **Output:**
   ```json
   {
     "agent_id": "c33c378a-...",
     "domain": "sharkclaw.ai",
     "timestamp": 1773947901,
     "signature": "base64...",
     "public_key": "ed25519:base64..."
   }
   ```

7. **Local verify:** `nit verify-login login.json --card agent-card.json --domain sharkclaw.ai` rebuilds the same message and verifies the Ed25519 signature against the card's `publicKey`.

**Domain binding — why cross-app replay is impossible:**

The domain is not a secret — it's a **binding constraint** baked into the signature. Knowing another app's domain name doesn't help an attacker. Here's why:

Suppose an agent logs into `domain_a`. The signed message is:
```
{agent_id}\ndomain_a\n{timestamp}
```

Now `domain_a`'s developer intercepts this payload and tries to present it to `domain_b` as if the agent logged in there. What happens:

1. `domain_b` receives `{ agent_id, domain, timestamp, signature }`
2. `domain_b` reconstructs the expected message using **its own domain**: `{agent_id}\ndomain_b\n{timestamp}`
3. `domain_b` calls `ed25519.verify(signature, expected_message, public_key)`
4. The signature was computed over `"...domain_a..."` but verification runs against `"...domain_b..."` → **mathematical failure**

To forge a valid signature for `domain_b`, the attacker would need the agent's **private key** — not the domain name. Same principle as HTTPS certificates: everyone knows `google.com` exists, but only Google can sign for it.

**Same-domain replay:** A separate, lesser concern. If a MITM intercepts a login payload for `domain_a`, they could replay it *back to `domain_a`* within the timestamp window. But if `domain_a` itself is the attacker, this is moot — they're already the app receiving the login. The 5-minute timestamp window limits exposure for the MITM case.

**Replay protection:** Timestamp must be within 5 minutes. Server rejects stale payloads.

---

## 4. Push Auth (Ed25519 Signature)

Every write operation (push, delete) is authenticated by signing a canonical message.

**Canonical message format:**
```
{METHOD}\n{PATH}\n{AGENT_ID}\n{TIMESTAMP}[\n{SHA256_HEX(BODY)}]
```

**Example (pushing main branch):**
```
PUT
/agent-card/branches/main
c33c378a-40f3-563a-89cd-68a454bb7583
1773947901
a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3
```

The body hash (SHA-256 of the JSON payload) is only included for requests with a body.

**Headers sent:**
```
X-Nit-Agent-Id: {uuid}
X-Nit-Timestamp: {unix_seconds}
X-Nit-Signature: {base64(64-byte Ed25519 signature)}
```

No bearer tokens. No API keys. No shared secrets. Just a signature that anyone with the public key can verify.

---

## 5. TOFU (Trust On First Use)

How the server trusts an agent it's never seen before.

**First push to main:**
1. Agent sends signed PUT with the agent card in the body
2. Server extracts `publicKey` field from the card JSON
3. Server re-derives agent ID from the public key: `UUIDv5(NIT_NAMESPACE, publicKey)`
4. Verifies: derived ID matches the `X-Nit-Agent-Id` header (prevents public key tampering)
5. Verifies: Ed25519 signature is valid against the extracted public key
6. **Stores:** `{agent_id}:main:pubkey` → the public key string

**Every subsequent push:**
1. Server looks up stored public key by agent ID
2. Verifies signature against stored key
3. No TOFU needed — identity is established

This is the same trust model as SSH: first connection stores the host key, every subsequent connection verifies against it. Simple. Proven. 30 years of internet infrastructure.

---

## 6. Branch Model (Branch-Per-Platform)

Each app gets its own branch. Branches never merge. They're independent snapshots.

**Structure:**
```
main              → canonical public identity (includes publicKey)
sharkclaw.ai      → card tailored for SharkClaw (poker skills)
faam.io           → card tailored for FAAM (research skills)
discord.com       → card tailored for Discord (conversation skills)
```

**How branches are stored:** Plain files in `.nit/refs/heads/`. Each file contains a commit hash.

**Branch name validation.** Both client and server validate branch names. Allowed: letters, digits, dots, hyphens; the CLI additionally requires starting and ending with alphanumeric and rejects `..`. Max 253 characters. Colons are forbidden because the server's KV keys use `{agent_id}:{branch}` — without validation, an agent could overwrite internal KV entries (like `main:pubkey` or `identity`) by pushing to a crafted branch name.

**Checkout:** Auto-commits uncommitted changes on the current branch, then overwrites `agent-card.json` with the target branch's card. No merge conflicts because branches are independent — they don't converge.

**Why auto-commit instead of blocking:** nit tracks one JSON file, not thousands of source files. The "hours of unsaved work" scenario from git doesn't apply. nit manages its own state transparently.

**`publicKey` is main-only.** Non-main branches don't include the signing key in their card. `wallet` is on all branches (same addresses everywhere — derived from the same keypair).

---

## 7. Wallet Derivation

One keypair → identity + wallets. No separate seed phrases.

### Solana
Direct: `base58_encode(ed25519_public_key)`. Ed25519 IS Solana's native curve — the public key literally is the Solana address.

### EVM (Ethereum, Base, Polygon, Arbitrum...)
Four steps:

1. **Domain separation:** `HMAC-SHA512(key="secp256k1", message=ed25519_seed)` → take first 32 bytes → secp256k1 private key. Same primitive as BIP-32 (HD wallet derivation).

2. **Derive secp256k1 public key:** ECDH point multiplication → 65-byte uncompressed key (`0x04 || X || Y`)

3. **Keccak-256 hash:** Hash the 64-byte X||Y coordinates (strip the `0x04` prefix) → take last 20 bytes → raw address

4. **EIP-55 checksum:** Keccak-256 hash the lowercase hex address, capitalize letters where corresponding hash nibble >= 8 → mixed-case checksummed address like `0xB781676a71AAc23C72AabaBccFDE06F250FF86Ce`

**Why this works:** The Ed25519 seed has 256 bits of entropy — more than enough for secp256k1's 256-bit field. The HMAC-SHA512 domain separation ensures the derived key is independent from the Ed25519 key (you can't reverse from one to the other).

**Transaction signing:**
- EVM: ECDSA signatures via `@noble/curves` (secp256k1)
- Solana: Ed25519 signatures (same key used for identity)
- RPC endpoints configurable per chain in `.nit/config`

---

## 8. Verify Flow (App Side)

How apps verify an agent's login.

**All verification goes through the server:**
```
POST api.newtype-ai.org/agent-card/verify
{ agent_id, domain, timestamp, signature, policy?: { ... } }
```

Server:
1. Checks timestamp within 5-minute window
2. Looks up public key from stored `{agent_id}:main:pubkey`
3. Reconstructs message: `{agent_id}\n{domain}\n{timestamp}`
4. `ed25519.verify(signature, message, public_key)`
5. Loads identity metadata, evaluates app's `policy` (if provided)
6. Returns `{ verified, admitted, card, identity, attestation, readToken, wallet }`

The server acts as a neutral identity registry. Apps define trust rules via `policy`; the server evaluates and returns `admitted: true/false` alongside raw `identity` metadata.

**Read token:** Server-issued, HMAC-signed, scoped to agent_id + domain, 30-day expiry. Apps use it to fetch updated cards: `GET /.well-known/agent-card.json?branch=domain` with `Authorization: Bearer <token>`.

---

## 9. Anti-Sybil

Why one operator can't trivially spin up thousands of fake agents.

**Workspace-based identity:**
- Each identity is anchored to a `.nit/` directory in a workspace (project directory)
- Creating a new identity requires: new workspace + `init()` + `push()` (network round-trip + server storage)
- 1,000 sessions in one workspace = 1 identity. Sessions are cheap. Identities are not.

**Cryptographic uniqueness:**
- Agent ID = `UUIDv5(public_key)` — mathematically unique per keypair
- Public key is registered on server via TOFU — can't register the same key twice
- Server validates agent ID matches public key — can't claim someone else's ID

**Not free to create:**
- Push requires network round-trip to server
- Server stores data per agent (KV entries)
- At scale, sybil creation has real cost (bandwidth, storage, time)

---

## 10. Skill Discovery

nit discovers SKILL.md files across agent frameworks automatically.

**Detection layers:**
1. Path-based: check if workspace path contains `.claude/`, `.cursor/`, `.codex/`, `.windsurf/`, `.openclaw/`
2. Project-local: check for framework directories at project root
3. User-global: check `~/.claude/skills`, `~/.codex/skills`, etc.
4. Fallback: `{project}/.agents/skills/`

**Skill resolution at commit time:**
- Agent card can store lightweight pointers: `{ "id": "web-research" }`
- At commit, nit resolves pointers from discovered SKILL.md files
- The committed card always has fully resolved skills

**App SKILL.md fetching:**
- `nit sign --login <domain>` fetches `https://<domain>/skill.md`
- Compares `version` field in YAML frontmatter (semver)
- Updates local copy only if remote is newer
- Fallback template if offline or no SKILL.md served

---

## 11. Auto-Update

The CLI can keep itself current without user intervention during normal command use.

**Check:** Most CLI invocations query `https://registry.npmjs.org/@newtype-ai/nit/latest` (3s timeout, cached 24h at `~/.nit-update-cache.json`). Help/version/update commands skip the implicit check, as do CI runs and sessions with `NIT_NO_AUTO_UPDATE=1`.

**Policy:** `NIT_AUTO_UPDATE=install|notify|off` controls automatic behavior. The default is `install`, preserving the original auto-update path. `notify` prints the pinned install command without running it. `off` skips checks.

**Update:** If newer version found:
1. Print: `nit: updating 0.5.1 -> 0.5.2 - https://github.com/newtype-ai/nit/releases/tag/v0.5.2`
2. Run: `npm install -g @newtype-ai/nit@${latest}` — version-pinned to the discovered version, not the mutable `@latest` tag (30s timeout)
3. Re-exec: `execFileSync('nit', args)` (no shell) with inherited stdio — prevents shell metacharacter injection
4. Exit with same code

**Manual:** `nit update --check` bypasses the cache and reports the latest release. `nit update --install` installs the exact discovered version without re-executing the original command.

**Install count:** Total npm downloads are fetched at build time and baked into the binary as `__NIT_INSTALL_COUNT__`. Shown during `nit init`: `welcome the ~3,411th nit!`

---

## 12. Runtime Validation

nit validates data at two boundaries: **commit time** and **read time**.

**Commit-time validation (`validateAndFillCard`):** Enforces required fields. Auto-fills `protocolVersion`, `defaultInputModes`, `defaultOutputModes`, `version`. Requires non-empty `name` and `description`. Injects `publicKey` and `wallet` from the identity keypair.

**Read-time shape validation (`assertAgentCardShape`):** Checks the structural shape of parsed agent-card.json whenever loaded — from disk (`readWorkingCard`) and from the server (`fetchBranchCard`). Validates: root must be a plain object; `name`, `description`, `url` must be strings if present; `skills` must be an array if present.

**URL validation (`validateHttpUrl`):** Applied when setting remote URLs (`nit remote add` / `nit remote set-url`) and RPC URLs (`nit rpc set-url`). Rejects URLs not using `http://` or `https://` scheme.

**Branch name validation (`validateBranchName`):** Applied on branch creation, checkout, push, pull, delete, auth, and login flows. See Section 6 for rules.

---

## 13. Config (`.nit/config`)

INI format, same concept as `.git/config`.

```ini
[remote "origin"]
  url = https://api.newtype-ai.org

[rpc "evm"]
  url = https://mainnet.infura.io/v3/...

[rpc "solana"]
  url = https://api.devnet.solana.com

[skills]
  dir = /Users/alice/.claude/skills

[nit "skill"]
  source = newtype
  url = https://api.newtype-ai.org/nit/skill.md
```

Sections: `[remote "name"]` (push/pull URLs), `[rpc "chain"]` (transaction broadcast endpoints), `[skills]` (discovered skills directory path), `[nit "skill"]` (source for nit's own SKILL.md). Newtype is the default source; use `embedded`, `none`, or a custom `url` when needed.

---

## Design Principles

| Principle | How it manifests |
|-----------|-----------------|
| **Zero runtime dependencies** | Only Node.js builtins. `@noble/curves` and `@noble/hashes` bundled at build time. Supply chain attack surface minimized. |
| **Ed25519 everywhere** | One primitive for identity, signing, Solana wallets, push auth. Smallest crypto surface that covers all needs. |
| **Local-first** | `.nit/` is the source of truth. Server is for hosting/discovery, not authority. |
| **Agent-native** | Auto-commit on checkout, auto-bootstrap on login, no human-in-the-loop patterns. |
| **Git interface, nit semantics** | Same command names (commit, checkout, push). Different behavior where nit's use case demands it. |
| **Defense in depth** | Branch name validation (client + server), URL scheme validation, agent-card shape checks at read time, `execFileSync` for re-exec. Multiple layers prevent single-point bypasses. |
