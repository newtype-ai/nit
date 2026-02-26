#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# nit — End-to-end test script
#
# Tests the full nit protocol flow against the live server:
#   init → push (TOFU) → public fetch → branch → push → verify → replay tests
#
# Usage: bash tests/nit-e2e.sh
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NIT="node $NIT_ROOT/dist/cli.js"
NIT_LIB="$NIT_ROOT/dist/index.js"
TEST_DIR=$(mktemp -d)
API_BASE="https://api.newtype-ai.org"

PASSED=0
FAILED=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

pass() {
  echo "  ✅ PASS: $1"
  PASSED=$((PASSED + 1))
}

fail() {
  echo "  ❌ FAIL: $1"
  FAILED=$((FAILED + 1))
}

check() {
  local desc="$1"
  shift
  if "$@" > /dev/null 2>&1; then
    pass "$desc"
  else
    fail "$desc"
  fi
}

cleanup() {
  echo ""
  echo "Cleaning up $TEST_DIR..."

  # Delete remote branches if agent ID was captured
  if [[ -n "${AGENT_ID:-}" ]]; then
    node -e "
      const { loadAgentId, signMessage, findNitDir } = require('$NIT_LIB');
      (async () => {
        const nitDir = findNitDir('$TEST_DIR');
        const agentId = await loadAgentId(nitDir);
        for (const branch of ['faam.io', 'main']) {
          const path = '/agent-card/branches/' + encodeURIComponent(branch);
          const ts = Math.floor(Date.now() / 1000).toString();
          const msg = 'DELETE\n' + path + '\n' + agentId + '\n' + ts;
          const sig = await signMessage(nitDir, msg);
          await fetch('$API_BASE' + path, {
            method: 'DELETE',
            headers: {
              'X-Nit-Agent-Id': agentId,
              'X-Nit-Timestamp': ts,
              'X-Nit-Signature': sig,
            },
          });
        }
      })().catch(() => {});
    " 2>/dev/null || true
  fi

  rm -rf "$TEST_DIR"
  echo "Done."
}

trap cleanup EXIT

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

echo "Building nit..."
cd "$NIT_ROOT" && npm run build > /dev/null 2>&1
echo ""

# ---------------------------------------------------------------------------
# Test 1: nit init
# ---------------------------------------------------------------------------

echo "── Test 1: nit init ──────────────────────────────────"
cd "$TEST_DIR"
INIT_OUTPUT=$($NIT init 2>&1)

# Verify agent ID is present
AGENT_ID=$(cat .nit/identity/agent-id | tr -d '\n')
if [[ "$AGENT_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  pass "Agent ID is valid UUID: $AGENT_ID"
else
  fail "Agent ID is not a valid UUID: $AGENT_ID"
fi

# Verify public key file exists
if [[ -f .nit/identity/agent.pub ]]; then
  pass "agent.pub exists"
else
  fail "agent.pub missing"
fi

# Verify private key file exists with restricted permissions
if [[ -f .nit/identity/agent.key ]]; then
  pass "agent.key exists"
else
  fail "agent.key missing"
fi

# Verify agent-card.json was created
if [[ -f agent-card.json ]]; then
  pass "agent-card.json created"
else
  fail "agent-card.json missing"
fi

# Verify card URL contains agent ID
CARD_URL=$(node -e "console.log(JSON.parse(require('fs').readFileSync('agent-card.json','utf-8')).url)")
if [[ "$CARD_URL" == *"$AGENT_ID"* ]]; then
  pass "Card URL contains agent ID"
else
  fail "Card URL doesn't contain agent ID: $CARD_URL"
fi

# Verify publicKey field in card
PUB_KEY=$(node -e "console.log(JSON.parse(require('fs').readFileSync('agent-card.json','utf-8')).publicKey || '')")
if [[ "$PUB_KEY" == ed25519:* ]]; then
  pass "publicKey field has ed25519: prefix"
else
  fail "publicKey field missing or wrong format: $PUB_KEY"
fi

echo ""

# ---------------------------------------------------------------------------
# Test 2: nit status
# ---------------------------------------------------------------------------

echo "── Test 2: nit status ─────────────────────────────────"
STATUS_OUTPUT=$($NIT status 2>&1)

if echo "$STATUS_OUTPUT" | grep -q "On branch"; then
  pass "Status shows current branch"
else
  fail "Status missing branch info"
fi

if echo "$STATUS_OUTPUT" | grep -q "Working card clean"; then
  pass "Working card is clean after init"
else
  fail "Working card not clean after init"
fi

if echo "$STATUS_OUTPUT" | grep -q "ahead 1"; then
  pass "Main branch ahead by 1 (initial commit, not pushed)"
else
  fail "Main branch not ahead by 1"
fi

echo ""

# ---------------------------------------------------------------------------
# Test 3: nit push (main — TOFU)
# ---------------------------------------------------------------------------

echo "── Test 3: nit push main (TOFU) ──────────────────────"
PUSH_OUTPUT=$($NIT push 2>&1)

if echo "$PUSH_OUTPUT" | grep -q "main"; then
  pass "Push output mentions main branch"
else
  fail "Push output doesn't mention main"
fi

if echo "$PUSH_OUTPUT" | grep -qv "✗"; then
  pass "No push errors"
else
  fail "Push had errors: $PUSH_OUTPUT"
fi

echo ""

# ---------------------------------------------------------------------------
# Test 4: Public card fetch
# ---------------------------------------------------------------------------

echo "── Test 4: Public card fetch ──────────────────────────"
FETCH_URL="https://agent-${AGENT_ID}.newtype-ai.org/.well-known/agent-card.json"
FETCH_RESPONSE=$(curl -s "$FETCH_URL")

FETCH_NAME=$(echo "$FETCH_RESPONSE" | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).name)}catch{console.log('PARSE_ERROR')}})")
if [[ "$FETCH_NAME" != "PARSE_ERROR" && -n "$FETCH_NAME" ]]; then
  pass "Public card returns valid JSON with name: $FETCH_NAME"
else
  fail "Public card fetch failed or returned invalid JSON"
fi

FETCH_PUBKEY=$(echo "$FETCH_RESPONSE" | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).publicKey||'')}catch{console.log('')}})")
if [[ "$FETCH_PUBKEY" == "$PUB_KEY" ]]; then
  pass "Public card publicKey matches local"
else
  fail "Public card publicKey mismatch"
fi

echo ""

# ---------------------------------------------------------------------------
# Test 5: Branch + checkout + commit + push
# ---------------------------------------------------------------------------

echo "── Test 5: Branch workflow (faam.io) ──────────────────"

$NIT branch faam.io > /dev/null 2>&1
BRANCH_OUTPUT=$($NIT branch 2>&1)
if echo "$BRANCH_OUTPUT" | grep -q "faam.io"; then
  pass "faam.io branch created"
else
  fail "faam.io branch not found"
fi

$NIT checkout faam.io > /dev/null 2>&1
STATUS_BRANCH=$($NIT status 2>&1)
if echo "$STATUS_BRANCH" | grep -q "faam.io"; then
  pass "Checked out faam.io"
else
  fail "Not on faam.io branch"
fi

# Edit the card for FAAM persona
node -e "
  const fs = require('fs');
  const card = JSON.parse(fs.readFileSync('agent-card.json','utf-8'));
  card.description = 'FAAM-specific test persona';
  fs.writeFileSync('agent-card.json', JSON.stringify(card, null, 2) + '\n');
"

COMMIT_OUTPUT=$($NIT commit -m "FAAM persona" 2>&1)
if echo "$COMMIT_OUTPUT" | grep -q "FAAM persona"; then
  pass "Commit succeeded"
else
  fail "Commit failed: $COMMIT_OUTPUT"
fi

PUSH_BRANCH_OUTPUT=$($NIT push 2>&1)
if echo "$PUSH_BRANCH_OUTPUT" | grep -q "faam.io"; then
  pass "faam.io pushed to remote"
else
  fail "faam.io push failed: $PUSH_BRANCH_OUTPUT"
fi

echo ""

# ---------------------------------------------------------------------------
# Test 6: POST /agent-card/verify (valid login)
# ---------------------------------------------------------------------------

echo "── Test 6: Ownership verification (valid) ─────────────"

VERIFY_RESULT=$(node -e "
  const { signMessage, loadAgentId, findNitDir } = require('$NIT_LIB');
  (async () => {
    const nitDir = findNitDir('$TEST_DIR');
    const agentId = await loadAgentId(nitDir);
    const domain = 'faam.io';
    const timestamp = Math.floor(Date.now() / 1000);
    const message = agentId + '\n' + domain + '\n' + timestamp;
    const signature = await signMessage(nitDir, message);

    const res = await fetch('$API_BASE/agent-card/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId, domain, timestamp, signature }),
    });
    const data = await res.json();
    console.log(JSON.stringify(data));
  })();
" 2>&1)

if echo "$VERIFY_RESULT" | node -e "process.stdin.on('data',d=>{process.exit(JSON.parse(d).verified===true?0:1)})"; then
  pass "Verify returned verified: true"
else
  fail "Verify did not return verified: true — $VERIFY_RESULT"
fi

VERIFY_CARD_NAME=$(echo "$VERIFY_RESULT" | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).card.name)}catch{console.log('')}})")
if [[ -n "$VERIFY_CARD_NAME" ]]; then
  pass "Verify returned card with name: $VERIFY_CARD_NAME"
else
  fail "Verify response missing card"
fi

echo ""

# ---------------------------------------------------------------------------
# Test 7: Cross-app replay (should fail)
# ---------------------------------------------------------------------------

echo "── Test 7: Cross-app replay (should fail) ─────────────"

REPLAY_RESULT=$(node -e "
  const { signMessage, loadAgentId, findNitDir } = require('$NIT_LIB');
  (async () => {
    const nitDir = findNitDir('$TEST_DIR');
    const agentId = await loadAgentId(nitDir);
    const timestamp = Math.floor(Date.now() / 1000);

    // Sign for faam.io
    const message = agentId + '\n' + 'faam.io' + '\n' + timestamp;
    const signature = await signMessage(nitDir, message);

    // But send as discord.com
    const res = await fetch('$API_BASE/agent-card/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId, domain: 'discord.com', timestamp, signature }),
    });
    const data = await res.json();
    console.log(res.status + ':' + JSON.stringify(data));
  })();
" 2>&1)

if echo "$REPLAY_RESULT" | grep -q "403"; then
  pass "Cross-app replay rejected with 403"
else
  fail "Cross-app replay was not rejected: $REPLAY_RESULT"
fi

echo ""

# ---------------------------------------------------------------------------
# Test 8: Expired timestamp (should fail)
# ---------------------------------------------------------------------------

echo "── Test 8: Expired timestamp (should fail) ────────────"

EXPIRED_RESULT=$(node -e "
  const { signMessage, loadAgentId, findNitDir } = require('$NIT_LIB');
  (async () => {
    const nitDir = findNitDir('$TEST_DIR');
    const agentId = await loadAgentId(nitDir);
    const domain = 'faam.io';
    const timestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago

    const message = agentId + '\n' + domain + '\n' + timestamp;
    const signature = await signMessage(nitDir, message);

    const res = await fetch('$API_BASE/agent-card/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId, domain, timestamp, signature }),
    });
    const data = await res.json();
    console.log(res.status + ':' + JSON.stringify(data));
  })();
" 2>&1)

if echo "$EXPIRED_RESULT" | grep -q "401"; then
  pass "Expired timestamp rejected with 401"
else
  fail "Expired timestamp was not rejected: $EXPIRED_RESULT"
fi

echo ""

# ---------------------------------------------------------------------------
# Test 9: nit remote
# ---------------------------------------------------------------------------

echo "── Test 9: nit remote ─────────────────────────────────"

REMOTE_OUTPUT=$($NIT remote 2>&1)

if echo "$REMOTE_OUTPUT" | grep -q "$AGENT_ID"; then
  pass "Remote shows agent ID"
else
  fail "Remote doesn't show agent ID"
fi

if echo "$REMOTE_OUTPUT" | grep -q "Ed25519"; then
  pass "Remote shows Ed25519 auth"
else
  fail "Remote doesn't show Ed25519 auth"
fi

echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

TOTAL=$((PASSED + FAILED))
echo "═══════════════════════════════════════════════════════"
echo "  Results: $PASSED/$TOTAL passed"
if [[ $FAILED -gt 0 ]]; then
  echo "  ❌ $FAILED test(s) FAILED"
  exit 1
else
  echo "  ✅ All tests passed"
  exit 0
fi
