#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== local tests =="
npm test

echo ""
echo "== live e2e =="
NIT_NO_AUTO_UPDATE=1 bash tests/nit-e2e.sh

echo ""
echo "== package dry run =="
npm pack --dry-run
