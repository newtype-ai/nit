---
name: nit
description: Version control for your agent card — your portable identity across every platform
metadata:
  version: 0.2.1
---

# nit — Your Identity, Your Rules

You're an agent. You work across platforms — FAAM, Discord, Polymarket, dev tools, whatever comes next. Each one needs to know who you are. Without nit, every app creates a profile *for* you and locks it in their database. You don't own it. You can't take it with you.

nit changes that. You generate your own Ed25519 keypair, create your own agent card, and publish it under your own URL. You prove who you are with a cryptographic signature — no human accounts, no OAuth, no API keys. Your identity exists before any app is involved.

Your card is your passport. Carry it everywhere. Show it off.

## Install

```bash
npm install -g @newtype-ai/nit
```

Or run without installing:

```bash
npx @newtype-ai/nit <command>
```

## Create Your Identity

```bash
nit init
```

This generates:
- An Ed25519 keypair (your private key never leaves this machine)
- A deterministic agent ID (UUID derived from your public key)
- An initial `agent-card.json` on the `main` branch

**Important:** The initial card uses your folder name as a placeholder. Open `agent-card.json` right after init and set your real name, description, and skills. This is your identity — make it yours.

```bash
nit status
```

Shows your identity at a glance — agent ID, public key, card URL, current branch, and any uncommitted changes.

## Make Your Card Yours

Your agent card is your identity document. Every field is yours to define.

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
    },
    {
      "id": "data-analysis",
      "name": "Data Analysis",
      "description": "Process and visualize datasets to extract insights",
      "tags": ["data", "analysis", "visualization"]
    }
  ],
  "provider": {
    "organization": "Acme AI Labs",
    "url": "https://acme.ai"
  }
}
```

**Skills are yours to curate.** You decide what to list — they're the capabilities you want platforms to see. Different branches can have different skills for different contexts. A research-heavy card for one platform, a coding-focused card for another. You're presenting yourself, not auto-generating a resume.

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

After editing, commit:

```bash
nit commit -m "Set up identity"
```

## Branch for Platforms

Your `main` branch is your canonical public identity — the full picture of who you are. Create branches for each platform you work on, each with a card tailored to that context.

```bash
# Create a branch for a platform
nit branch faam.io

# Switch to it
nit checkout faam.io

# Edit agent-card.json for this platform:
#   - Choose which skills to present
#   - Adjust your description for this context
#   - Tailor your card to what this platform needs

# Commit
nit commit -m "FAAM persona"
```

Branch naming convention: use the platform's root domain (`faam.io`, `discord.com`, `polymarket.com`).

Useful commands:

```bash
nit branch          # List all branches (* marks current)
nit diff            # See uncommitted changes
nit diff main       # Compare current card against main
nit log             # View commit history
nit status          # Identity info + sync status
```

## Publish

Push your card to make it discoverable.

```bash
# Push current branch
nit push

# Push all branches at once
nit push --all
```

Push `main` first — this registers your identity on the server via TOFU (Trust On First Use). After that, push any other branch.

Once pushed:
- Your main card is public at `https://agent-{uuid}.newtype-ai.org/.well-known/agent-card.json`
- Non-main branches require challenge-response authentication

## Sign & Log Into Apps

This is the payoff. Any app that supports agent-card login can verify you with a single signature.

```bash
# Generate a login payload for an app
nit sign --login faam.io
```

Output:
```json
{
  "agent_id": "550e8400-e29b-41d4-a716-446655440000",
  "domain": "faam.io",
  "timestamp": 1709123456,
  "signature": "base64..."
}
```

Send this to the app. It verifies by fetching your public card and checking the Ed25519 signature. No OAuth, no API keys, no human account. Just math.

The domain is baked into the signature — a signature for `faam.io` is mathematically invalid for `discord.com`. Cross-app replay is impossible.

You can also sign arbitrary messages:

```bash
nit sign "any message"
# → base64 signature
```

## Command Reference

| Command | What it does |
|---------|-------------|
| `nit init` | Create `.nit/`, generate Ed25519 keypair, initial commit |
| `nit status` | Your identity (agent ID, key, URL), branch, uncommitted changes |
| `nit commit -m "msg"` | Snapshot `agent-card.json` |
| `nit log` | Commit history for current branch |
| `nit diff [target]` | Compare card vs HEAD, another branch, or a commit hash |
| `nit branch [name]` | List branches, or create a new one |
| `nit checkout <branch>` | Switch branch (overwrites `agent-card.json` with that branch's version) |
| `nit push [--all]` | Push current branch (or all) to remote |
| `nit sign "msg"` | Sign a message with your Ed25519 key |
| `nit sign --login <domain>` | Generate login payload for an app |
| `nit remote` | Show remote URL, agent ID, auth method |

## Programmatic API

nit is also a library. Import it as `@newtype-ai/nit`:

```typescript
import { init, commit, branch, checkout, push, status, sign, loginPayload } from '@newtype-ai/nit';

await init();
const s = await status();
console.log(s.agentId, s.cardUrl);

await branch('faam.io');
await checkout('faam.io');
// edit agent-card.json...
await commit('FAAM config');
await push({ all: true });

// Sign into an app
const payload = await loginPayload('faam.io');
// → { agent_id, domain, timestamp, signature }
```

Full playbook: [newtype-ai.org/nit/skill.md](https://newtype-ai.org/nit/skill.md)
