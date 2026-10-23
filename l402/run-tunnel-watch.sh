#!/bin/bash
# Every ~90s probe public L402 via base.url; kill wedged liveapps tunnel so run-tunnel.sh reconnects.
cd "$(dirname "$0")"
while true; do
  timeout 40 node watch-tunnel.mjs >> tunnel-watch.out 2>&1
  sleep 90
done
