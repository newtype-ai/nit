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
| `nit status` | Current branch, uncommitted changes, ahead/behind remote |
| `nit commit -m "msg"` | Snapshot agent-card.json (auto-resolves SKILL.md pointers) |
| `nit log` | Commit history for current branch |
| `nit diff [target]` | JSON diff vs HEAD, branch, or commit |
| `nit branch [name]` | List branches or create a new one |
| `nit checkout <branch>` | Switch branch (overwrites agent-card.json) |
| `nit push [--all]` | Push branch(es) to remote |
| `nit remote` | Show remote URL and credential status |

## How It Works

### Identity

`nit init` generates an Ed25519 keypair stored in `.nit/identity/`. The public key is embedded in your agent card as:

```json
{
  "publicKey": "ed25519:<base64-key>"
}
```

Platforms verify your identity by challenging you to sign a nonce — no shared secrets, no bearer tokens.

### Branches

Each branch is a different agent card for a different platform. Branch name = root domain of the platform (e.g., `faam.io`, `polymarket.com`).

`nit checkout faam.io` overwrites `./agent-card.json` with that branch's version.

### Skill Resolution

At commit time, nit discovers SKILL.md files from all major agent frameworks:

- `.claude/skills/` — Claude Code
- `.cursor/skills/` — Cursor
- `.windsurf/skills/` — Windsurf
- `.codex/skills/` — OpenAI Codex
- `.agents/skills/` — Generic

Skills referenced in your card are resolved against these files, and the committed card contains a self-contained snapshot.

### Remote Protocol

The main branch is public. Non-main branches require signed-challenge authentication:

```
GET /.well-known/agent-card.json              → main card (public)
GET /.well-known/agent-card.json?branch=faam.io  → 401 { challenge }
GET ... + X-Nit-Signature + X-Nit-Challenge   → branch card
```

nit is the client. Any server can implement the protocol. [newtype-ai.org](https://newtype-ai.org) provides a hosted implementation.

## Directory Structure

```
your-project/
├── .nit/                    # nit repository (gitignored)
│   ├── HEAD                 # Current branch ref
│   ├── config               # Remote credentials
│   ├── identity/
│   │   ├── agent.pub        # Ed25519 public key
│   │   └── agent.key        # Ed25519 private key (0600)
│   ├── objects/              # Content-addressable store
│   └── refs/heads/           # Branch pointers
├── agent-card.json          # Working copy (changes with checkout)
└── ...
```

## Programmatic API

```typescript
import { init, commit, checkout, branch, push, status } from '@newtype-ai/nit';

await init();
await branch('faam.io');
await checkout('faam.io');
// modify agent-card.json...
await commit('FAAM config');
await push({ all: true });
```

## Design Principles

- **Zero runtime dependencies** — uses only Node.js builtins
- **nit is neutral** — knows nothing about any specific platform
- **Agent card is the identity** — the keypair proves "I am this agent"
- **Like git, not GitHub** — nit is the tool, newtype-ai.org is a hosting service

## License

MIT
