# nit

Version control for agent cards.

nit manages `agent-card.json` the way git manages source code. One agent, different cards for different platforms — each branch is a platform-specific identity.

## Why

An agent working across multiple platforms (FAAM, Polymarket, etc.) needs to present different capabilities to each. nit lets you maintain branch-per-platform versions of your agent card, with cryptographic identity via Ed25519 keypairs.

```
main             → full agent card (public, discoverable)
faam.io         → { skills: [content, social], description: "Content creator..." }
polymarket.com   → { skills: [research, trading], description: "Market analyst..." }
```

## Install

```bash
npm install -g @newtype-ai/nit
```

Or use directly:

```bash
npx @newtype-ai/nit init
```

## Quick Start

```bash
# Initialize in your project directory
nit init

# Create a platform-specific branch
nit branch faam.io

# Switch to it and customize the card
nit checkout faam.io
# edit agent-card.json...
nit commit -m "FAAM config"

# Push all branches to remote
nit push --all
```

## Commands

| Command | Description |
|---------|-------------|
| `nit init` | Create `.nit/`, generate Ed25519 keypair, initial commit |
| `nit status` | Identity info, current branch, uncommitted changes |
| `nit commit -m "msg"` | Snapshot agent-card.json |
| `nit log` | Commit history for current branch |
| `nit diff [target]` | JSON diff vs HEAD, branch, or commit |
| `nit branch [name]` | List branches or create a new one |
| `nit checkout <branch>` | Switch branch (overwrites agent-card.json) |
| `nit push [--all]` | Push branch(es) to remote |
| `nit sign "msg"` | Sign a message with your Ed25519 key |
| `nit sign --login <domain>` | Auto-switch to domain branch + generate login payload |
| `nit remote` | Show remote URL and credential status |
| `nit remote add <name> <url>` | Add a new remote |
| `nit remote set-url <name> <url>` | Change a remote's URL |

## How It Works

### Identity

`nit init` generates an Ed25519 keypair stored in `.nit/identity/`. The public key is embedded in your agent card as:

```json
{
  "publicKey": "ed25519:<base64-key>"
}
```

Platforms verify your identity by challenging you to sign a nonce — no shared secrets, no bearer tokens.

nit also derives blockchain wallet addresses from your keypair — Solana (Ed25519 native) and EVM chains (Ethereum, BSC, Polygon, etc.) via a deterministic secp256k1 derivation. Run `nit status` to see your addresses.

### Branches

Each branch is a different agent card for a different platform. Branch name = root domain of the platform (e.g., `faam.io`, `polymarket.com`).

`nit checkout faam.io` overwrites `./agent-card.json` with that branch's version.

### Skill Resolution

Your card can store skills as **pointers** — just `{ "id": "skill-name" }` — resolved from SKILL.md files at commit time. SKILL.md is the single source of truth when present.

nit auto-discovers your skills directory from all major agent frameworks:

- `.claude/skills/` — Claude Code
- `.cursor/skills/` — Cursor
- `.windsurf/skills/` — Windsurf
- `.codex/skills/` — OpenAI Codex
- `.openclaw/workspace/skills/` — OpenClaw

The discovered path is stored in `.nit/config`. When `nit sign --login <domain>` creates a new branch, it auto-creates a SKILL.md template and adds a pointer to the card. The committed card always contains fully resolved, self-contained skill data.

### Remote Protocol

The main branch is public. Non-main branches require signed-challenge authentication:

```
GET /.well-known/agent-card.json              → main card (public)
GET /.well-known/agent-card.json?branch=faam.io  → 401 { challenge }
GET ... + X-Nit-Signature + X-Nit-Challenge   → branch card
```

nit is the client. Any server can implement the protocol. [newtype-ai.org](https://newtype-ai.org) is the recommended free hosting service, but you can point to any compatible server:

```bash
nit remote set-url origin https://my-server.com
```

## Directory Structure

```
your-project/
├── .nit/                    # nit repository (gitignored)
│   ├── HEAD                 # Current branch ref
│   ├── config               # Remote URL, credentials, skills directory
│   ├── identity/
│   │   ├── agent.pub        # Ed25519 public key
│   │   ├── agent.key        # Ed25519 private key (0600)
│   │   └── agent-id         # UUIDv5 derived from public key
│   ├── objects/              # Content-addressable store
│   └── refs/heads/           # Branch pointers
├── agent-card.json          # Working copy (changes with checkout)
└── ...
```

## Programmatic API

```typescript
import { init, commit, checkout, branch, push, status, sign, loginPayload, loadRawKeyPair, getWalletAddresses } from '@newtype-ai/nit';

await init();

// Log into an app (auto-creates and switches to domain branch)
const payload = await loginPayload('faam.io');
// → { agent_id, domain, timestamp, signature, switchedBranch, createdSkill }

// Customize card, then commit & push
await commit('FAAM config');
await push({ all: true });

// Access raw Ed25519 keypair (64 bytes: [seed || pubkey])
const keypair = await loadRawKeyPair('/path/to/.nit');
// → Uint8Array(64) — compatible with Solana and other Ed25519 libraries

// Get blockchain wallet addresses (derived from your identity)
const addresses = await getWalletAddresses('/path/to/.nit');
// → { solana: "C54kvW3...", ethereum: "0x2317..." }
```

## Design Principles

- **Zero runtime dependencies** — uses only Node.js builtins
- **nit is neutral** — knows nothing about any specific platform
- **Agent card is the identity** — the keypair proves "I am this agent"
- **Like git, not GitHub** — nit is the tool, newtype-ai.org is a hosting service

## License

MIT
