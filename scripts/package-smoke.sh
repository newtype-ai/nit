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
CONFIG_AFTER_INIT="$(cat .nit/config)"
SHOW_BEFORE="$(HOME="$FAKE_HOME" NIT_NO_AUTO_UPDATE=1 ./node_modules/.bin/nit skill dir)"
SET_OUTPUT="$(HOME="$FAKE_HOME" NIT_NO_AUTO_UPDATE=1 ./node_modules/.bin/nit skill dir shared-skills)"
SHOW_SET="$(HOME="$FAKE_HOME" NIT_NO_AUTO_UPDATE=1 ./node_modules/.bin/nit skill dir)"
RESET_OUTPUT="$(HOME="$FAKE_HOME" NIT_NO_AUTO_UPDATE=1 ./node_modules/.bin/nit skill dir --reset)"
SHOW_RESET="$(HOME="$FAKE_HOME" NIT_NO_AUTO_UPDATE=1 ./node_modules/.bin/nit skill dir)"
export CONFIG_AFTER_INIT SHOW_BEFORE SET_OUTPUT SHOW_SET RESET_OUTPUT SHOW_RESET

node --input-type=module <<'NODE'
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const cwd = process.cwd();
const card = JSON.parse(readFileSync('agent-card.json', 'utf8'));
if (!Array.isArray(card.skills) || card.skills.length !== 0) {
  throw new Error(`fresh card should not include skills, got ${JSON.stringify(card.skills)}`);
}

const expectedSkillsDir = join(cwd, '.agents', 'skills');
if (!process.env.CONFIG_AFTER_INIT?.includes(`dir = ${expectedSkillsDir}`)) {
  throw new Error(`expected generated skills dir ${expectedSkillsDir}, got:\n${process.env.CONFIG_AFTER_INIT}`);
}
if (process.env.CONFIG_AFTER_INIT.includes(process.env.HOME)) {
  throw new Error(`config leaked HOME into skills dir:\n${process.env.CONFIG_AFTER_INIT}`);
}

const customSkillsDir = join(cwd, 'shared-skills');
if (!process.env.SHOW_BEFORE?.includes(expectedSkillsDir) || !process.env.SHOW_BEFORE.includes('source = configured')) {
  throw new Error(`expected initial skill dir to be configured project dir, got:\n${process.env.SHOW_BEFORE}`);
}
if (!process.env.SET_OUTPUT?.includes(customSkillsDir)) {
  throw new Error(`expected set output to include ${customSkillsDir}, got:\n${process.env.SET_OUTPUT}`);
}
if (!existsSync(customSkillsDir)) {
  throw new Error(`skill dir set did not create ${customSkillsDir}`);
}
if (!process.env.SHOW_SET?.includes(customSkillsDir) || !process.env.SHOW_SET.includes('source = configured')) {
  throw new Error(`expected custom skill dir to be configured, got:\n${process.env.SHOW_SET}`);
}
if (!process.env.RESET_OUTPUT?.includes(expectedSkillsDir) || !process.env.RESET_OUTPUT.includes('source = auto')) {
  throw new Error(`expected reset output to return to auto project dir, got:\n${process.env.RESET_OUTPUT}`);
}
if (!process.env.SHOW_RESET?.includes(expectedSkillsDir) || !process.env.SHOW_RESET.includes('source = auto')) {
  throw new Error(`expected skill dir after reset to remain auto, got:\n${process.env.SHOW_RESET}`);
}

const resetConfig = readFileSync(join('.nit', 'config'), 'utf8');
if (resetConfig.includes('[skills]')) {
  throw new Error(`reset should clear [skills] override, got:\n${resetConfig}`);
}
if (resetConfig.includes(customSkillsDir) || resetConfig.includes(process.env.HOME)) {
  throw new Error(`reset config leaked custom or home path:\n${resetConfig}`);
}
NODE

echo "packaged CLI smoke passed"
