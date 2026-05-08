#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nit-init-count-smoke.XXXXXX")"
DIST_BACKUP="$TMP_ROOT/dist-backup"
HAD_DIST=0

cleanup() {
  cd "$ROOT"
  rm -rf dist
  if [[ "$HAD_DIST" == "1" ]]; then
    cp -R "$DIST_BACKUP" dist
  fi
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

cd "$ROOT"
if [[ -d dist ]]; then
  HAD_DIST=1
  cp -R dist "$DIST_BACKUP"
fi

export NPM_CONFIG_CACHE="$TMP_ROOT/npm-cache"
export npm_config_cache="$TMP_ROOT/npm-cache"

NIT_INSTALL_COUNT=12345 npm run build >/dev/null
PACK_JSON="$(npm pack --json --pack-destination "$TMP_ROOT")"
TARBALL="$(printf '%s' "$PACK_JSON" | node -e "let input = ''; process.stdin.on('data', (chunk) => input += chunk); process.stdin.on('end', () => { const pack = JSON.parse(input); process.stdout.write(pack[0].filename); });")"
TARBALL_PATH="$TMP_ROOT/$TARBALL"

FAKE_HOME="$TMP_ROOT/home"
WORKSPACE="$TMP_ROOT/workspace"
mkdir -p "$FAKE_HOME" "$WORKSPACE"

cd "$WORKSPACE"
npm install "$TARBALL_PATH" >/dev/null
INIT_OUTPUT="$(HOME="$FAKE_HOME" NIT_NO_AUTO_UPDATE=1 ./node_modules/.bin/nit init --skill-source none)"

if ! printf '%s\n' "$INIT_OUTPUT" | sed -E 's/\x1B\[[0-9;]*[mK]//g' | grep -q 'welcome the ~12,345th nit!'; then
  echo "nit init did not show the baked install count"
  echo "$INIT_OUTPUT"
  exit 1
fi

echo "nit init count smoke passed"
