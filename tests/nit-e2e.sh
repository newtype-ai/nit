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

LAST_OUTPUT=""
LAST_STDERR=""
LAST_STATUS=0

capture() {
  set +e
  LAST_OUTPUT="$("$@" 2>&1)"
  LAST_STATUS=$?
  LAST_STDERR=""
  set -e
}

capture_stdout() {
  local err_file
  err_file="$(mktemp)"
  set +e
  LAST_OUTPUT="$("$@" 2>"$err_file")"
  LAST_STATUS=$?
  set -e
  LAST_STDERR="$(cat "$err_file")"
  rm -f "$err_file"
  if [[ $LAST_STATUS -ne 0 && -n "$LAST_STDERR" ]]; then
    if [[ -n "$LAST_OUTPUT" ]]; then
      LAST_OUTPUT="$LAST_OUTPUT"$'\n'"$LAST_STDERR"
    else
      LAST_OUTPUT="$LAST_STDERR"
    fi
  fi
}

require_success() {
  local desc="$1"
  shift
  capture "$@"
  if [[ $LAST_STATUS -ne 0 ]]; then
    fail "$desc failed with exit $LAST_STATUS: $LAST_OUTPUT"
    exit 1
  fi
}

require_stdout_success() {
  local desc="$1"
  shift
  capture_stdout "$@"
  if [[ $LAST_STATUS -ne 0 ]]; then
    fail "$desc failed with exit $LAST_STATUS: $LAST_OUTPUT"
    exit 1
  fi
}

retry_success() {
  local desc="$1"
  local attempts="$2"
  local delay="$3"
  shift 3

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    capture "$@"
    if [[ $LAST_STATUS -eq 0 ]]; then
      return 0
    fi
    if [[ $attempt -lt $attempts ]]; then
      echo "  retry $attempt/$attempts: $desc failed with exit $LAST_STATUS"
      sleep "$delay"
    fi
  done

  fail "$desc failed after $attempts attempts with exit $LAST_STATUS: $LAST_OUTPUT"
  exit 1
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
require_success "nit init" $NIT init
INIT_OUTPUT="$LAST_OUTPUT"

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
# Test 1b: remote config after init
# ---------------------------------------------------------------------------

echo "── Test 1b: remote config ───────────────────────────────"

# Verify default remote URL in config
if grep -q "url = https://api.newtype-ai.org" .nit/config; then
  pass "Default remote URL set in config"
else
  fail "Default remote URL missing from config"
fi

# Verify nit remote shows the URL
require_success "nit remote" $NIT remote
REMOTE_OUTPUT="$LAST_OUTPUT"
if echo "$REMOTE_OUTPUT" | grep -q "https://api.newtype-ai.org"; then
  pass "nit remote shows default URL"
else
  fail "nit remote missing default URL"
fi

# Test set-url
require_success "nit remote set-url origin" $NIT remote set-url origin https://example.com
if grep -q "url = https://example.com" .nit/config; then
  pass "set-url updated config"
else
  fail "set-url did not update config"
fi

# Test add
require_success "nit remote add backup" $NIT remote add backup https://backup.example.com
if grep -q 'remote "backup"' .nit/config && grep -q "url = https://backup.example.com" .nit/config; then
  pass "remote add created new remote"
else
  fail "remote add did not create new remote"
fi

# Restore default URL for remaining tests
require_success "nit remote restore origin" $NIT remote set-url origin https://api.newtype-ai.org

echo ""

# ---------------------------------------------------------------------------
# Test 2: nit status
# ---------------------------------------------------------------------------

echo "── Test 2: nit status ─────────────────────────────────"
require_success "nit status" $NIT status
STATUS_OUTPUT="$LAST_OUTPUT"

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
retry_success "nit push main" 3 2 $NIT push
PUSH_OUTPUT="$LAST_OUTPUT"

if echo "$PUSH_OUTPUT" | grep -q "main"; then
  pass "Push output mentions main branch"
else
  fail "Push output doesn't mention main"
fi

if ! echo "$PUSH_OUTPUT" | grep -q "✗"; then
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
retry_success "public card fetch" 3 2 curl -fsS "$FETCH_URL"
FETCH_RESPONSE="$LAST_OUTPUT"

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

require_success "nit branch faam.io" $NIT branch faam.io
require_success "nit branch list" $NIT branch
BRANCH_OUTPUT="$LAST_OUTPUT"
if echo "$BRANCH_OUTPUT" | grep -q "faam.io"; then
  pass "faam.io branch created"
else
  fail "faam.io branch not found"
fi

require_success "nit checkout faam.io" $NIT checkout faam.io
require_success "nit status after checkout" $NIT status
STATUS_BRANCH="$LAST_OUTPUT"
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

require_success "nit commit FAAM persona" $NIT commit -m "FAAM persona"
COMMIT_OUTPUT="$LAST_OUTPUT"
if echo "$COMMIT_OUTPUT" | grep -q "FAAM persona"; then
  pass "Commit succeeded"
else
  fail "Commit failed: $COMMIT_OUTPUT"
fi

retry_success "nit push faam.io" 3 2 $NIT push
PUSH_BRANCH_OUTPUT="$LAST_OUTPUT"
if echo "$PUSH_BRANCH_OUTPUT" | grep -q "faam.io" && ! echo "$PUSH_BRANCH_OUTPUT" | grep -q "✗"; then
  pass "faam.io pushed to remote"
else
  fail "faam.io push failed: $PUSH_BRANCH_OUTPUT"
fi

echo ""

# ---------------------------------------------------------------------------
# Test 6: POST /agent-card/verify (valid login)
# ---------------------------------------------------------------------------

echo "── Test 6: Ownership verification (valid) ─────────────"

retry_success "server verify valid login" 3 2 node -e "
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
"
VERIFY_RESULT="$LAST_OUTPUT"

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

retry_success "server reject cross-app replay" 3 2 node -e "
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
"
REPLAY_RESULT="$LAST_OUTPUT"

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

retry_success "server reject expired timestamp" 3 2 node -e "
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
"
EXPIRED_RESULT="$LAST_OUTPUT"

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

require_success "nit remote final" $NIT remote
REMOTE_OUTPUT="$LAST_OUTPUT"

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
# Test 10: nit sign
# ---------------------------------------------------------------------------

echo "── Test 10: nit sign ─────────────────────────────────"

# Sign arbitrary message
require_success "nit sign arbitrary message" $NIT sign "hello world"
SIGN_OUTPUT="$LAST_OUTPUT"
if [[ "$SIGN_OUTPUT" =~ ^[A-Za-z0-9+/=]+$ ]] && [[ ${#SIGN_OUTPUT} -gt 40 ]]; then
  pass "nit sign outputs base64 signature (${#SIGN_OUTPUT} chars)"
else
  fail "nit sign output doesn't look like base64: $SIGN_OUTPUT"
fi

# Login payload (capture stdout only — stderr has status messages)
require_stdout_success "nit sign login" $NIT sign --login faam.io
LOGIN_OUTPUT="$LAST_OUTPUT"
LOGIN_AGENT_ID=$(echo "$LOGIN_OUTPUT" | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).agent_id)}catch{console.log('')}})")
LOGIN_DOMAIN=$(echo "$LOGIN_OUTPUT" | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).domain)}catch{console.log('')}})")
LOGIN_TIMESTAMP=$(echo "$LOGIN_OUTPUT" | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).timestamp)}catch{console.log('')}})")
LOGIN_SIGNATURE=$(echo "$LOGIN_OUTPUT" | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).signature)}catch{console.log('')}})")

if [[ "$LOGIN_AGENT_ID" == "$AGENT_ID" ]]; then
  pass "Login payload has correct agent_id"
else
  fail "Login payload agent_id mismatch: $LOGIN_AGENT_ID"
fi

if [[ "$LOGIN_DOMAIN" == "faam.io" ]]; then
  pass "Login payload has correct domain"
else
  fail "Login payload domain mismatch: $LOGIN_DOMAIN"
fi

if [[ -n "$LOGIN_TIMESTAMP" ]] && [[ "$LOGIN_TIMESTAMP" =~ ^[0-9]+$ ]]; then
  pass "Login payload has valid timestamp"
else
  fail "Login payload timestamp invalid: $LOGIN_TIMESTAMP"
fi

# Verify login signature against the server
retry_success "server verify nit sign login output" 3 2 node -e "
  (async () => {
    const res = await fetch('$API_BASE/agent-card/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: '$LOGIN_AGENT_ID',
        domain: '$LOGIN_DOMAIN',
        timestamp: $LOGIN_TIMESTAMP,
        signature: '$LOGIN_SIGNATURE',
      }),
    });
    const data = await res.json();
    console.log(data.verified ? 'VERIFIED' : 'FAILED');
  })();
"
VERIFY_LOGIN="$LAST_OUTPUT"
if [[ "$VERIFY_LOGIN" == "VERIFIED" ]]; then
  pass "Login payload signature verified by server"
else
  fail "Login payload signature rejected by server: $VERIFY_LOGIN"
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
