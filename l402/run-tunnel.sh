#!/bin/bash
# Public URL for the L402 server via liveapps.dev (no account, WebSocket over 443).
# Fixed name hexbox-3d so 402index / OpenAPI / agent listings survive restarts.
# After a SIGKILL the liveapps reservation can linger → subdomain_taken. Wait it out
# before falling back. hostc (random *.hostc.app) is last resort; named preferred.
# --no-reconnect (Oct 17 r55): the CLI used to retry with its expired 5-min reservation after a
# heartbeat timeout (box freeze) and loop on "subdomain_taken: reservation_expired" -> public 503.
# Exiting lets this loop reserve fresh, which succeeds right away.
# Current URL -> base.url
cd "$(dirname "$0")"
fails=0
NAMED_MAX=${TUNNEL_NAMED_MAX:-6}          # ~6 * 45s ≈ 4.5 min of reservation wait
TAKEN_SLEEP=${TUNNEL_TAKEN_SLEEP:-45}     # liveapps holds name briefly after SIGKILL
HOSTC_SECS=${TUNNEL_HOSTC_SECS:-180}      # then retry named so listings don't go stale

hostc_ok() {
  node -e "import('ws').then(()=>import('uqr')).then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null
}

wait_cooldown() {
  if [ -f tunnel-cooldown.until ]; then
    until_ts=$(cat tunnel-cooldown.until 2>/dev/null || echo 0)
    now=$(date +%s)
    if [ -n "$until_ts" ] && [ "$until_ts" -gt "$now" ] 2>/dev/null; then
      wait_s=$((until_ts - now))
      echo "$(date -Is) cooldown ${wait_s}s (post-SIGKILL reservation)" >> tunnel.log
      sleep "$wait_s"
    fi
    rm -f tunnel-cooldown.until
  fi
}

while true; do
  wait_cooldown
  if [ "$fails" -lt "$NAMED_MAX" ]; then
    # only judge THIS session's lines: our own "fail=N/6" notes contain the word
    # subdomain_taken and used to make a healthy session count as a failure
    start_lines=$(wc -l < tunnel.log)
    node --experimental-websocket node_modules/liveapps/dist/cli.js tunnel --port 8796 --name hexbox-3d --unlisted --json --no-reconnect 2>>tunnel.log | while read -r l; do
      echo "$(date -Is) $l" >> tunnel.log
      u=$(echo "$l" | grep -o '"url":"https://[^"]*' | cut -d'"' -f4)
      [ -n "$u" ] && echo "$u" > base.url
    done
    new_lines=$(tail -n +"$((start_lines + 1))" tunnel.log)
    if echo "$new_lines" | grep -q '"url":"https://'; then
      fails=0   # connected this session; any later drop is not a name clash
    elif echo "$new_lines" | grep -v 'fail=' | grep -q subdomain_taken; then
      fails=$((fails + 1))
      echo "$(date -Is) subdomain_taken fail=$fails/${NAMED_MAX}, sleep ${TAKEN_SLEEP}s" >> tunnel.log
      sleep "$TAKEN_SLEEP"
    else
      fails=0
    fi
  else
    if hostc_ok; then
      echo "$(date -Is) named unavailable after ${fails} taken; hostc fallback ${HOSTC_SECS}s" >> tunnel.log
      # timeout so we reclaim hexbox-3d instead of living on a random URL forever
      timeout "$HOSTC_SECS" node node_modules/hostc/dist/hostc.mjs 8796 2>&1 | while read -r l; do
        echo "$(date -Is) $l" >> tunnel.log
        u=$(echo "$l" | grep -oE 'https://[a-z0-9]+\.hostc\.app')
        [ -n "$u" ] && echo "$u" > base.url
      done
      echo "$(date -Is) hostc ended; retrying named hexbox-3d" >> tunnel.log
      # put preferred URL back in base.url aspirationally; next successful named write wins
      echo "https://hexbox-3d.liveapps.dev" > base.url
    else
      echo "$(date -Is) hostc missing ws/uqr; staying on named retries" >> tunnel.log
      sleep 30
    fi
    fails=0
  fi
  echo "$(date -Is) tunnel exited, restarting" >> tunnel.log
  sleep 5
done
