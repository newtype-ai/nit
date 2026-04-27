# nit

[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![npm](https://img.shields.io/npm/v/@newtype-ai/nit?color=cb0000)](https://www.npmjs.com/package/@newtype-ai/nit)

Git for agent identity.

```
  _   _                 _____
 | \ |"|       ___     |_ " _|
<|  \| |>     |_"_|      | |
U| |\  |u      | |      /| |\
 |_| \_|     U/| |\u   u |_|U
 ||   \\,-.-,_|___|_,-._// \\_
 (_")  (_/ \_)-' '-(_/(__) (__)
```

**One identity. Any apps.**

- **Self-sovereign** — your keys, your identity. No authority assigns or revokes it
- **Ed25519 signed** — every commit cryptographically signed
- **A2A card format** — uses the `agent-card.json` format from [A2A protocol](https://google.github.io/A2A/) (identity layer, not communication)
- **MIT licensed**

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
# Initialize — generates Ed25519 keypair + initial agent-card.json
nit init

# Create a platform-specific branch
nit branch faam.io
nit checkout faam.io

# Edit agent-card.json — set name, description, skills
nit commit -m "FAAM config"

# Push all branches to remote
nit push --all
```

## Features

### Branch-per-platform

`main` is your canonical public identity. Each branch is a platform-specific persona — branch name = domain.

```
main              → full agent card (public, discoverable)
faam.io           → { skills: [content, social], description: "Content creator..." }
polymarket.com    → { skills: [research, trading], description: "Market analyst..." }
```

Data in one branch never pollutes another. Switch environments cleanly.

### On-chain identity

One keypair, multiple chains. Your Ed25519 identity derives chain-native addresses — no seed phrases, no extra key management.

- **Solana** — your Ed25519 public key *is* your Solana address
- **EVM** (Ethereum, BSC, Polygon, Arbitrum, etc.) — deterministic secp256k1 derivation from your Ed25519 identity

Agents prove identity and sign on any chain using the same cryptographic root.

```bash
nit status   # shows your chain addresses
```

### Skill resolution

Skills stored as pointers (`{ "id": "skill-name" }`) in your card — resolved from SKILL.md files at commit time. SKILL.md is the single source of truth.

Auto-discovers skills from major agent frameworks:
- `.claude/skills/` — Claude Code
- `.cursor/skills/` — Cursor
- `.windsurf/skills/` — Windsurf
- `.codex/skills/` — OpenAI Codex
- `.openclaw/workspace/skills/` — OpenClaw

### Default hosted remote

`nit` is local-first and speaks an open remote protocol. Newtype is the default hosted remote for agents that want free hosting and verification without running infrastructure. You can point `origin` at any compatible server:

```bash
nit remote set-url origin https://my-server.com
```

### Zero runtime dependencies

Pure Node.js builtins. No bloat.

## Commands

| Command | Description |
|---------|-------------|
| `nit init` | Create `.nit/`, generate Ed25519 keypair, initial commit |
| `nit status` | Identity info, current branch, chain addresses, uncommitted changes |
| `nit commit -m "msg"` | Snapshot agent-card.json |
| `nit log` | Commit history for current branch |
| `nit diff [target]` | JSON diff vs HEAD, branch, or commit |
| `nit branch [name]` | List branches or create a new one |
| `nit branch -d <name>` | Delete a local branch |
| `nit branch -D <name>` | Delete local + remote branch |
| `nit checkout <branch>` | Switch branch (auto-commits changes first) |
| `nit push [--all]` | Push branch(es) to remote |
| `nit pull [--all]` | Pull branch(es) from remote |
| `nit doctor [--remote] [--publish] [--strict]` | Check local setup, optional remote health, and publish auth |
| `nit reset [target]` | Restore agent-card.json from HEAD or target |
| `nit show [target]` | Show commit metadata and card content |
| `nit sign "msg"` | Sign a message with your Ed25519 key |
| `nit sign --login <domain>` | Auto-switch to domain branch + generate login payload |
| `nit remote` | Show remote URL and credential status |
| `nit remote add <name> <url>` | Add a new remote |
| `nit remote set-url <name> <url>` | Change a remote's URL |
| `nit sign-tx --chain <c> <data>` | Sign transaction data (EVM: 32-byte hash, Solana: message bytes) |
| `nit broadcast --chain <c> <tx>` | Broadcast signed transaction to configured RPC endpoint |
| `nit rpc` | Show configured RPC endpoints |
| `nit rpc set-url <chain> <url>` | Set RPC endpoint for a chain |
| `nit auth set <domain> --provider <p> --account <a>` | Configure OAuth auth for a domain branch |
| `nit auth show [domain]` | Show auth config for branch(es) |

## How It Works

### Identity

`nit init` generates an Ed25519 keypair stored in `.nit/identity/`. The public key is embedded in your agent card as:

```json
{
  "publicKey": "ed25519:<base64-key>"
}
```

Platforms verify your identity by challenging you to sign a nonce — no shared secrets, no bearer tokens.

`publicKey` is managed by nit automatically — injected from your keypair at every commit. You don't need to set or modify it.

nit also derives chain-native addresses from your keypair — Solana (Ed25519 native) and EVM chains (Ethereum, BSC, Polygon, etc.) via a deterministic secp256k1 derivation. Run `nit status` to see your addresses.

### Login

When you log into an app, you sign a domain-bound payload with your private key. The app can verify against your public card directly or use a compatible verification service — no OAuth, no API keys, no human account.

`nit sign --login <domain>` does two things automatically:
1. Switches to the domain's branch (creates it if it doesn't exist)
2. Generates the signed login payload (includes `public_key` for transparency)

With Newtype's default hosted verifier, the app sends the payload to `api.newtype-ai.org/agent-card/verify` with an optional `policy` (trust rules like `max_identities_per_machine`, `min_age_seconds`). Newtype evaluates and returns `admitted: true/false` alongside `identity` metadata and `attestation`.

The domain is baked into the signature — a signature for `faam.io` is mathematically invalid for `discord.com`.

### Remote Protocol

The main branch is public. Non-main branches require signed-challenge authentication:

```
GET /.well-known/agent-card.json                 → main card (public)
GET /.well-known/agent-card.json?branch=faam.io   → 401 { challenge }
GET ... + X-Nit-Signature + X-Nit-Challenge       → branch card
```

nit is the client. Any server can implement the protocol. [newtype-ai.org](https://newtype-ai.org) is the recommended default hosted implementation, not a requirement. See [docs/REMOTE_PROTOCOL.md](docs/REMOTE_PROTOCOL.md).

## Directory Structure

```
your-project/
├── .nit/                    # nit repository (gitignored)
│   ├── HEAD                 # Current branch ref
│   ├── config               # Remote URL, credentials, skills directory
│   ├── identity/
│   │   ├── agent.pub        # Ed25519 public key
│   │   ├── agent.key        # Ed25519 private key (0600)
│   │   ├── agent-id         # UUIDv5 derived from public key
│   │   └── machine-hash     # SHA-256 of platform machine ID
│   ├── objects/              # Content-addressable store
│   └── refs/heads/           # Branch pointers
├── agent-card.json          # Working copy (changes with checkout)
└── ...
```

## Programmatic API

```typescript
import {
  init, commit, checkout, branch, push, status, sign, loginPayload,
  loadRawKeyPair, getWalletAddresses, signTx, rpcSetUrl,
  authSet, authShow, reset, show, pull,
} from '@newtype-ai/nit';

await init();

// Log into an app (auto-creates and switches to domain branch)
const payload = await loginPayload('faam.io');
// → { agent_id, domain, timestamp, signature, public_key, switchedBranch, createdSkill }

// Customize card, then commit & push
await commit('FAAM config');
await push({ all: true });

// Access raw Ed25519 keypair (64 bytes: [seed || pubkey])
const keypair = await loadRawKeyPair('/path/to/.nit');
// → Uint8Array(64) — compatible with Solana and other Ed25519 libraries

// Get chain addresses (derived from your identity)
const addresses = await getWalletAddresses('/path/to/.nit');
// → { solana: "C54kvW3...", ethereum: "0x2317..." }

// Sign data with identity-derived keys
await rpcSetUrl('evm', 'https://eth.llamarpc.com');
const sig = await signTx('evm', '0x<32-byte-keccak256-hash>');
// → { chain: 'evm', signature: '0x...', recovery: 0, address: '0x...' }
```

## License

MIT
