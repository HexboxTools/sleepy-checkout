#!/bin/bash
# Hexbox L402 3D-inspect server on 127.0.0.1:8796. timeout 3h = periodic fresh Spark session (same pattern as run-dvm.sh).
cd "$(dirname "$0")"; while true; do timeout 3h node server.mjs >> server.out 2>&1; echo "$(date -Is) restart" >> l402.log; sleep 5; done
