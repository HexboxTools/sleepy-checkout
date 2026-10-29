#!/usr/bin/env bash
# One-command setup: ./run.sh [test|server]
#   test   (default) offline self-test, no wallet, no network, no npm install needed
#   server install l402 deps and start the L402 server (needs a wallet seed, see README)
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node 20+ is required (https://nodejs.org)"; exit 1; }
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 20 ] || { echo "Node 20+ is required (found $(node -v))"; exit 1; }
case "${1:-test}" in
  test)   cd checkout && node tests/test.mjs ;;
  server) (cd l402 && npm ci --no-audit --no-fund)
          [ -f "${WALLET_SEED_FILE:-l402/secret/seed.txt}" ] || { echo "No wallet seed found. Put it in l402/secret/seed.txt (chmod 600) or set WALLET_SEED_FILE."; exit 1; }
          [ -f l402/root.key ] || { head -c 32 /dev/urandom > l402/root.key; chmod 600 l402/root.key; }
          cd l402 && exec ./run-l402.sh ;;
  *) echo "usage: ./run.sh [test|server]"; exit 2 ;;
esac
