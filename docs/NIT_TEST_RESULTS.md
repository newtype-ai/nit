# nit — E2E Test Results

**Date:** 2026-02-26
**CLI version:** `@newtype-ai/nit@0.2.1`
**Server:** `newtype-agent-cards` worker at `*.newtype-ai.org`

## Test Script

The E2E test script lives at `github.com/newtype-ai/nit/tests/nit-e2e.sh`. Run it with:

```bash
cd /path/to/nit && bash tests/nit-e2e.sh
```

It creates a temp directory, runs the full nit flow against the live server, validates each step, cleans up remote branches on exit, and deletes the temp directory.

## Results: 23/23 passed

```
── Test 1: nit init ──────────────────────────────────
  ✅ PASS: Agent ID is valid UUID
  ✅ PASS: agent.pub exists
  ✅ PASS: agent.key exists
  ✅ PASS: agent-card.json created
  ✅ PASS: Card URL contains agent ID
  ✅ PASS: publicKey field has ed25519: prefix

── Test 2: nit status ─────────────────────────────────
  ✅ PASS: Status shows current branch
  ✅ PASS: Working card is clean after init
  ✅ PASS: Main branch ahead by 1 (initial commit, not pushed)

── Test 3: nit push main (TOFU) ──────────────────────
  ✅ PASS: Push output mentions main branch
  ✅ PASS: No push errors

── Test 4: Public card fetch ──────────────────────────
  ✅ PASS: Public card returns valid JSON with name
  ✅ PASS: Public card publicKey matches local

── Test 5: Branch workflow (faam.io) ──────────────────
  ✅ PASS: faam.io branch created
  ✅ PASS: Checked out faam.io
  ✅ PASS: Commit succeeded
  ✅ PASS: faam.io pushed to remote

── Test 6: Ownership verification (valid) ─────────────
  ✅ PASS: Verify returned verified: true
  ✅ PASS: Verify returned card with name

── Test 7: Cross-app replay (should fail) ─────────────
  ✅ PASS: Cross-app replay rejected with 403

── Test 8: Expired timestamp (should fail) ────────────
  ✅ PASS: Expired timestamp rejected with 401

── Test 9: nit remote ─────────────────────────────────
  ✅ PASS: Remote shows agent ID
  ✅ PASS: Remote shows Ed25519 auth
```

## What Each Test Covers

| Test | What it proves |
|------|---------------|
| 1. nit init | Keypair generation, agent ID derivation (UUIDv5), card URL auto-set, publicKey injection |
| 2. nit status | Clean working state after init, ahead/behind tracking |
| 3. nit push (TOFU) | Ed25519 signature auth works, server accepts first push, TOFU stores identity |
| 4. Public fetch | Card is publicly accessible at `agent-{uuid}.newtype-ai.org`, content matches local |
| 5. Branch workflow | Create branch, checkout, edit card, commit, push non-main branch |
| 6. Verify (valid) | `POST /agent-card/verify` returns `verified: true` with agent's card |
| 7. Cross-app replay | Signature for faam.io is rejected when sent as discord.com (403) |
| 8. Expired timestamp | Signature with 10-minute-old timestamp is rejected (401) |
| 9. nit remote | Shows agent ID and Ed25519 auth method |

## Security Properties Verified

- **Self-sovereign ID**: Agent ID derived from public key, not assigned by server
- **TOFU**: First push establishes identity; server stores public key
- **Ed25519 auth**: All writes authenticated via signature (no Bearer tokens)
- **Cross-app replay protection**: Domain in signed message prevents replay across apps
- **Replay protection**: 5-minute timestamp window enforced server-side
- **Cleanup**: Test deletes remote branches via signed DELETE requests on exit
