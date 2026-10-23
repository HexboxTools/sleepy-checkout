#!/bin/sh
# On-wake hook (NOT installed anywhere yet): mark sold/expired, top the pool back up, rebuild the unlock page.
# Receive-only: mints invoices, never pays. Usage: ./rotate.sh [product] [target]
cd "$(dirname "$0")" || exit 1
P=${1:-render-ladder}; T=${2:-3}
timeout 200 node pool.mjs rotate "$P" --target "$T" --min-days 7 >/dev/null && node pool.mjs offer "$P"
