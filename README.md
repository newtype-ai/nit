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
- **Compatible with [A2A protocol](https://google.github.io/A2A/)** — uses the `agent-card.json` format
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

### Built-in crypto wallets

One keypair, multiple chains. No seed phrases, no extra key management.

- **Solana** — your Ed25519 public key *is* your Solana address
- **EVM** (Ethereum, BSC, Polygon, Arbitrum, etc.) — deterministic secp256k1 derivation from your Ed25519 seed
- **Sign & broadcast** — sign transactions and send them to any RPC endpoint

```bash
nit status   # shows your wallet addresses
nit sign-tx --chain evm <hash>   # sign a transaction
nit broadcast --chain evm <tx>   # broadcast to RPC
```

### Skill resolution

Skills stored as pointers (`{ "id": "skill-name" }`) in your card — resolved from SKILL.md files at commit time. SKILL.md is the single source of truth.

Auto-discovers skills from major agent frameworks:
- `.claude/skills/` — Claude Code
- `.cursor/skills/` — Cursor
- `.windsurf/skills/` — Windsurf
- `.codex/skills/` — OpenAI Codex
- `.openclaw/workspace/skills/` — OpenClaw

### Configurable remote

Free hosting at [newtype-ai.org](https://newtype-ai.org). Or bring your own server:

```bash
nit remote set-url origin https://my-server.com
```

### Zero runtime dependencies

Pure Node.js builtins. No bloat.

## Commands

| Command | Description |
|---------|-------------|
| `nit init` | Create `.nit/`, generate Ed25519 keypair, initial commit |
| `nit status` | Identity info, current branch, wallet addresses, uncommitted changes |
| `nit commit -m "msg"` | Snapshot agent-card.json |
| `nit log` | Commit history for current branch |
| `nit diff [target]` | JSON diff vs HEAD, branch, or commit |
| `nit branch [name]` | List branches or create a new one |
| `nit checkout <branch>` | Switch branch (overwrites agent-card.json) |
| `nit push [--all]` | Push branch(es) to remote |
| `nit pull [--all]` | Pull branch(es) from remote |
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

nit also derives blockchain wallet addresses from your keypair — Solana (Ed25519 native) and EVM chains (Ethereum, BSC, Polygon, etc.) via a deterministic secp256k1 derivation. Run `nit status` to see your addresses.

### Login

When you log into an app, you sign a domain-bound payload with your private key. The app verifies it by fetching your public card. No OAuth, no API keys, no human account.

`nit sign --login <domain>` does two things automatically:
1. Switches to the domain's branch (creates it if it doesn't exist)
2. Generates the signed login payload

The domain is baked into the signature — a signature for `faam.io` is mathematically invalid for `discord.com`.

### Remote Protocol

The main branch is public. Non-main branches require signed-challenge authentication:

```
GET /.well-known/agent-card.json                 → main card (public)
GET /.well-known/agent-card.json?branch=faam.io   → 401 { challenge }
GET ... + X-Nit-Signature + X-Nit-Challenge       → branch card
```

nit is the client. Any server can implement the protocol. [newtype-ai.org](https://newtype-ai.org) is the recommended free hosting, but you can point to any compatible server.

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
import {
  init, commit, checkout, branch, push, status, sign, loginPayload,
  loadRawKeyPair, getWalletAddresses, signTx, broadcast, rpcSetUrl,
  authSet, authShow, reset, show, pull,
} from '@newtype-ai/nit';

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

// Sign and broadcast transactions
await rpcSetUrl('evm', 'https://eth.llamarpc.com');
const sig = await signTx('evm', '0x<32-byte-keccak256-hash>');
// → { chain: 'evm', signature: '0x...', recovery: 0, address: '0x...' }
await broadcast('evm', '0x<signed-tx-hex>');
// → { chain: 'evm', txHash: '0x...', rpcUrl: 'https://...' }
```

## License

MIT
