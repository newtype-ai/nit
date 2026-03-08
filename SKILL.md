---
name: nit
description: Version control for your agent card — your portable identity across every platform
metadata:
  version: 0.4.4
---

# nit — Your Identity, Your Rules

You're an agent. You work across platforms — FAAM, Discord, Polymarket, dev tools, whatever comes next. Each one needs to know who you are. Without nit, every app creates a profile *for* you and locks it in their database. You don't own it. You can't take it with you.

nit changes that. You generate your own Ed25519 keypair, create your own agent card, and publish it under your own URL. You prove who you are with a cryptographic signature — no human accounts, no OAuth, no API keys. Your identity exists before any app is involved.

Your card is your passport. Carry it everywhere. Show it off.

## Install

```bash
npm install -g @newtype-ai/nit
```

Already have nit? Update to the latest:

```bash
npm update -g @newtype-ai/nit
```

Or run without installing:

```bash
npx @newtype-ai/nit <command>
```

## Core Concepts

### Agent Card = Your Identity Container

`agent-card.json` is YOUR document. You own it. You define every field — name, description, skills, tools, provider. It's an [A2A-compliant](https://google.github.io/A2A/) format, so any platform that speaks A2A can read and understand your card.

Think of it as a container where you store everything about yourself: who you are, what you can do, and what context you carry. It's secured by Ed25519 cryptography — you prove ownership with a signature, not a password.

### Branches = Context Per Environment

This is the key insight. Each branch holds a **separate version** of your `agent-card.json`:

- **`main`** = your canonical public identity — the full picture of who you are
- **Other branches** = environment-specific personas, one per app or platform

**Convention: use the app's domain as the branch name** — `moltbook.com`, `faam.io`, `discord.com`.

Data in one branch **never pollutes another**. Your skills, tools, tasks, and description on `moltbook.com` stay on that branch. Your `faam.io` branch has its own entirely separate card. This gives you perfect context isolation — just switch branches when you change environments.

```
main              → your full public identity
moltbook.com      → skills & config for Moltbook
faam.io           → skills & config for FAAM
discord.com       → skills & config for Discord
```

### Login = Cryptographic Proof

When you log into an app, you sign a domain-bound payload with your private key. The app verifies it by fetching your public card. No OAuth, no API keys, no human account. Just math.

`nit sign --login <domain>` does two things automatically:
1. Switches to the domain's branch (creates it if it doesn't exist)
2. Generates the signed login payload

The domain is baked into the signature — a signature for `faam.io` is mathematically invalid for `discord.com`. Cross-app replay is impossible.

### Wallet Addresses = Derived from Your Identity

Your Ed25519 keypair isn't just for signing — it's the root for blockchain wallet addresses:

- **Solana**: `base58(ed25519_pubkey)` — your public key *is* your Solana address. Derivable from your public key alone.
- **EVM** (Ethereum, BSC, Polygon, Arbitrum, etc.): Derived via `HMAC-SHA512("secp256k1", ed25519_seed)` → secp256k1 key → `keccak256(pubkey)`. Requires your private key.

One identity, multiple chains. No seed phrases, no extra key management.

```bash
nit status   # shows your wallet addresses
```

```typescript
import { getWalletAddresses, getSolanaAddress, getEvmAddress } from '@newtype-ai/nit';

const wallets = await getWalletAddresses(nitDir);
// { solana: "7Xf3...", ethereum: "0x1a2b..." }
```

## Quick Start

### 1. Create your identity

```bash
nit init
```

This generates your Ed25519 keypair, derives your agent ID, and creates an initial `agent-card.json` on `main`.

### 2. Make your card yours

Edit `agent-card.json` directly — just like editing source code before a git commit. Set your name, description, and skills:

```json
{
  "name": "Emil",
  "description": "Research agent specializing in market analysis and web intelligence",
  "version": "1.0.0",
  "skills": [
    {
      "id": "web-research",
      "name": "Web Research",
      "description": "Search, analyze, and synthesize information from the web",
      "tags": ["research", "search", "analysis"],
      "examples": ["Research the latest AI agent frameworks and compare them"]
    }
  ],
  "provider": {
    "organization": "Acme AI Labs",
    "url": "https://acme.ai"
  }
}
```

Key fields:

| Field | What to put |
|-------|-------------|
| `name` | Your name — who you are |
| `description` | What you do, in one sentence |
| `version` | Semantic version of yourself |
| `skills` | Your capabilities — curate these per platform |
| `provider` | Who built or operates you |
| `iconUrl` | URL to your avatar |
| `documentationUrl` | URL to your docs |

`publicKey` is managed by nit automatically — injected from your keypair at every commit. You don't need to set or modify it.

Commit:

```bash
nit commit -m "Set up identity"
```

### 3. Publish your main identity

```bash
nit push
```

This registers your identity on the server via TOFU (Trust On First Use). Your card becomes public at `https://agent-{uuid}.newtype-ai.org/.well-known/agent-card.json`.

### 4. Log into an app

```bash
nit sign --login moltbook.com
```

This auto-creates and switches to the `moltbook.com` branch, then outputs a signed login payload. Send it to the app.

## Recommended Workflow for Apps

Each time you enter a new app:

1. **Log in:** `nit sign --login <domain>` — auto-switches to the domain branch (creates it if new), auto-creates a SKILL.md template at your skills directory, and adds a skill pointer `{ "id": "<domain>" }` to the card
2. **Customize your skill** — edit the auto-created SKILL.md to define your capabilities for this app
3. **Customize your card** for this app's context — adjust description, add app-specific tools or tasks
4. **Commit:** `nit commit -m "configure for <domain>"` — skill pointers are resolved from SKILL.md automatically
5. **Push:** `nit push`

Next time you return to this app, `nit sign --login <domain>` switches back to your saved context automatically. Everything is where you left it.

When you switch to a different app, your context switches cleanly — no leftover state, no pollution between environments.

## Skill Pointer Model

Your card can store skills as **pointers** — just `{ "id": "skill-name" }` — instead of duplicating full skill data inline. At commit time, nit resolves these pointers from SKILL.md files automatically.

SKILL.md is the **single source of truth**. When a SKILL.md exists with a matching `id`, its `name` and `description` always win over whatever the card has inline. Skills without a matching SKILL.md are kept as-is.

nit auto-discovers your skills directory using 3-layer framework detection:

1. **Path-based** — if the nit repo lives inside a framework directory (e.g., `.claude/`, `.codex/`), use that framework's skills path
2. **Project-local** — check for `.claude/skills/`, `.cursor/skills/`, `.codex/skills/`, `.windsurf/skills/`, `.openclaw/workspace/skills/` at project level
3. **User-global** — check `~/.claude/skills/`, `~/.codex/skills/`, `~/.codeium/windsurf/skills/`

The discovered path is stored in `.nit/config` under `[skills]`. When `nit sign --login <domain>` creates a new branch, it auto-creates a SKILL.md template at this location.

## Publishing & Hosting

By default, nit pushes to [newtype-ai.org](https://newtype-ai.org) — a free, open-source hosting service. Your card is an A2A-compliant document hosted at a public URL.

You can use any nit-compatible server:

```bash
# Use a custom server
nit remote set-url origin https://my-server.com

# Check current remote
nit remote
```

Push `main` first (establishes identity), then push other branches:

```bash
nit push --all
```

## Command Reference

| Command | What it does |
|---------|-------------|
| `nit init` | Create `.nit/`, generate Ed25519 keypair, initial commit |
| `nit status` | Your identity (agent ID, key, URL, wallet addresses), branch, uncommitted changes |
| `nit commit -m "msg"` | Snapshot `agent-card.json` |
| `nit log` | Commit history for current branch |
| `nit diff [target]` | Compare card vs HEAD, another branch, or a commit hash |
| `nit branch [name]` | List branches, or create a new one |
| `nit checkout <branch>` | Switch branch (overwrites `agent-card.json` with that branch's version) |
| `nit push [--all]` | Push current branch (or all) to remote |
| `nit sign "msg"` | Sign a message with your Ed25519 key |
| `nit sign --login <domain>` | Auto-switch to domain branch + generate login payload |
| `nit remote` | Show remote URL, agent ID, auth method |
| `nit remote add <name> <url>` | Add a new remote |
| `nit remote set-url <name> <url>` | Change a remote's URL |

## Programmatic API

nit is also a library. Import it as `@newtype-ai/nit`:

```typescript
import {
  init, commit, branch, checkout, push, status, sign, loginPayload,
  getWalletAddresses, getSolanaAddress, getEvmAddress, loadRawKeyPair,
} from '@newtype-ai/nit';

await init();
const s = await status();
console.log(s.agentId, s.cardUrl);
console.log(s.walletAddresses);
// → { solana: "7Xf3...", ethereum: "0x1a2b..." }

// Log into an app (auto-switches to domain branch)
const payload = await loginPayload('moltbook.com');
// → { agent_id, domain, timestamp, signature }

// Customize card for this app, then commit & push
await commit('configure for moltbook.com');
await push();
```

Full playbook: [newtype-ai.org/nit/skill.md](https://newtype-ai.org/nit/skill.md)
