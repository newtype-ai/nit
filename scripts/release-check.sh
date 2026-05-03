#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NPM_CACHE="$(mktemp -d "${TMPDIR:-/tmp}/nit-release-npm-cache.XXXXXX")"
cleanup() {
  rm -rf "$NPM_CACHE"
}
trap cleanup EXIT
export NPM_CONFIG_CACHE="$NPM_CACHE"
export npm_config_cache="$NPM_CACHE"

echo "== version sync =="
node scripts/check-skill-version.js

echo ""
echo "== local tests =="
npm test

echo ""
echo "== live e2e =="
NIT_NO_AUTO_UPDATE=1 bash tests/nit-e2e.sh

echo ""
echo "== packaged CLI smoke =="
bash scripts/package-smoke.sh

echo ""
echo "== package dry run =="
npm pack --dry-run
