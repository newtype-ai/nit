#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nit-package-smoke.XXXXXX")"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

cd "$ROOT"
export NPM_CONFIG_CACHE="$TMP_ROOT/npm-cache"
export npm_config_cache="$TMP_ROOT/npm-cache"
PACK_JSON="$(npm pack --json --pack-destination "$TMP_ROOT")"
TARBALL="$(printf '%s' "$PACK_JSON" | node -e "let input = ''; process.stdin.on('data', (chunk) => input += chunk); process.stdin.on('end', () => { const pack = JSON.parse(input); process.stdout.write(pack[0].filename); });")"
TARBALL_PATH="$TMP_ROOT/$TARBALL"

FAKE_HOME="$TMP_ROOT/home"
WORKSPACE="$TMP_ROOT/workspace"
mkdir -p "$FAKE_HOME/.claude/skills/global-only" "$WORKSPACE"
cat > "$FAKE_HOME/.claude/skills/global-only/SKILL.md" <<'SKILL'
---
name: Global Only
description: This global skill must not seed a fresh public card
---

# Global Only
SKILL

cd "$WORKSPACE"
npm install "$TARBALL_PATH" >/dev/null
HOME="$FAKE_HOME" NIT_NO_AUTO_UPDATE=1 ./node_modules/.bin/nit init --skill-source none >/dev/null

node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const cwd = process.cwd();
const card = JSON.parse(readFileSync('agent-card.json', 'utf8'));
if (!Array.isArray(card.skills) || card.skills.length !== 0) {
  throw new Error(`fresh card should not include skills, got ${JSON.stringify(card.skills)}`);
}

const config = readFileSync(join('.nit', 'config'), 'utf8');
const expectedSkillsDir = join(cwd, '.agents', 'skills');
if (!config.includes(`dir = ${expectedSkillsDir}`)) {
  throw new Error(`expected generated skills dir ${expectedSkillsDir}, got:\n${config}`);
}
if (config.includes(process.env.HOME)) {
  throw new Error(`config leaked HOME into skills dir:\n${config}`);
}
NODE

echo "packaged CLI smoke passed"
