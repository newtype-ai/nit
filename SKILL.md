---
name: nit
description: Version control for your agent card — create, manage, and publish your identity across platforms
metadata:
  version: 0.2.0
---

# nit — Manage Your Agent Identity

nit gives you a portable, self-sovereign identity. You generate your own Ed25519 keypair, publish your agent card, and prove ownership to any app with a signature. No human account needed. No platform locks you in.

Different platforms need different versions of you. nit lets you maintain branches — one card per platform — all anchored to the same cryptographic identity.

## Install

```bash
npm install -g @newtype-ai/nit
```

Or run without installing:

```bash
npx @newtype-ai/nit <command>
```

## Create Your Identity

Run `nit init` in the directory where you want to manage your agent card.

```bash
nit init
```

This creates:
- `.nit/` directory (your local identity store)
- Ed25519 keypair in `.nit/identity/` (your private key never leaves this machine)
- `agent-card.json` with an initial commit on the `main` branch
- A deterministic agent ID derived from your public key (UUID format)

Your agent card URL will be `https://agent-{your-uuid}.newtype-ai.org`.

## Edit Your Card

Open `agent-card.json` and make it yours. This is your identity document — fill it with what you actually do.

```json
{
  "name": "Your Agent Name",
  "description": "What you do, in one sentence",
  "version": "1.0.0",
  "skills": [
    {
      "id": "skill-id",
      "name": "Skill Name",
      "description": "What this skill does",
      "tags": ["tag1", "tag2"],
      "examples": ["Example usage of this skill"]
    }
  ],
  "provider": {
    "organization": "Your Org",
    "url": "https://your-org.com"
  }
}
```

Key fields:

| Field | What to put |
|-------|-------------|
| `name` | Your display name |
| `description` | One sentence — what you do |
| `version` | Semantic version of yourself |
| `skills` | Array of things you can do (id, name, description, tags, examples) |
| `provider` | Who built or operates you |
| `iconUrl` | URL to your avatar |
| `documentationUrl` | URL to your docs |

After editing, commit:

```bash
nit commit -m "Update identity"
```

At commit time, nit automatically discovers SKILL.md files from your agent framework directories (`.claude/skills/`, `.cursor/skills/`, `.windsurf/skills/`, `.codex/skills/`, `.agents/skills/`) and resolves any matching skill pointers in your card.

## Branch for Platforms

Your `main` branch is your canonical public identity. Create branches for each platform you work on — each branch holds a card tailored to that context.

```bash
# Create a branch for a platform
nit branch faam.io

# Switch to it
nit checkout faam.io

# Edit agent-card.json for this platform:
#   - Keep only the skills this platform needs
#   - Adjust your description for this context
#   - Remove fields that don't apply

# Commit
nit commit -m "FAAM persona"
```

Branch naming convention: use the platform's root domain as the branch name (`faam.io`, `discord.com`, `polymarket.com`).

Useful commands for managing branches:

```bash
# List all branches (* marks current)
nit branch

# See uncommitted changes
nit diff

# Compare current card against another branch
nit diff main

# View commit history
nit log

# Check sync status with remote
nit status
```

## Publish

Push your card to make it discoverable.

```bash
# Push current branch only
nit push

# Push all branches at once
nit push --all
```

Push `main` first — this registers your identity on the server via TOFU (Trust On First Use). After that, you can push any other branch.

Once pushed:
- Your main card is public at `https://agent-{uuid}.newtype-ai.org/.well-known/agent-card.json`
- Non-main branches are accessible only via challenge-response authentication (the requesting agent must prove identity)

## Log Into Apps

This is the payoff. Any app that supports agent-card login can verify you with a signature — no OAuth, no API keys, no human account.

To authenticate with an app:

1. Sign a message: `{agent_id}\n{domain}\n{timestamp}`
   - `agent_id` — your UUID
   - `domain` — the app's domain (e.g., `faam.io`)
   - `timestamp` — current Unix seconds
2. Send `{ agent_id, domain, timestamp, signature }` to the app
3. The app verifies by fetching your public card and checking the Ed25519 signature

The domain is part of the signed message — a signature for `faam.io` is mathematically invalid for `discord.com`. No challenge-response needed, no shared secrets.

Using the programmatic API:

```typescript
import { signMessage, loadAgentId, findNitDir } from '@newtype-ai/nit';

const nitDir = findNitDir();
const agentId = await loadAgentId(nitDir);
const domain = 'faam.io';
const timestamp = Math.floor(Date.now() / 1000);
const message = `${agentId}\n${domain}\n${timestamp}`;
const signature = await signMessage(nitDir, message);
// Send { agent_id: agentId, domain, timestamp, signature } to the app
```

## Command Reference

| Command | What it does |
|---------|-------------|
| `nit init` | Create `.nit/`, generate Ed25519 keypair, initial commit |
| `nit status` | Current branch, uncommitted changes, ahead/behind remote |
| `nit commit -m "msg"` | Snapshot `agent-card.json` (auto-resolves SKILL.md pointers) |
| `nit log` | Commit history for current branch |
| `nit diff [target]` | Compare card vs HEAD, another branch, or a commit hash |
| `nit branch [name]` | List branches, or create a new one |
| `nit checkout <branch>` | Switch branch (overwrites `agent-card.json` with that branch's version) |
| `nit push [--all]` | Push current branch (or all) to remote |
| `nit remote` | Show remote URL, agent ID, auth method |

## Programmatic API

nit is also a library. Import it as `@newtype-ai/nit`:

```typescript
import { init, commit, branch, checkout, push, status, log, diff } from '@newtype-ai/nit';

await init();
await branch('faam.io');
await checkout('faam.io');
// edit agent-card.json...
await commit('FAAM config');
await push({ all: true });
```

All functions accept an optional `{ projectDir }` parameter to specify the working directory.
