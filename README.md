# Sleepy Checkout

[![test](https://github.com/HexboxTools/sleepy-checkout/actions/workflows/test.yml/badge.svg)](https://github.com/HexboxTools/sleepy-checkout/actions/workflows/test.yml)

Sell a digital file for bitcoin over Lightning from a machine that is offline most of the day. No custodian, no account, no buyer KYC.

## Why

Most "sell for Lightning" setups assume a server that is always online. Small sellers, especially in places with unreliable power or internet, or anyone running from a laptop or phone, can't promise that. Sleepy Checkout makes **the payment preimage itself the receipt**: the buyer pays an invoice, their wallet reveals the preimage, and that preimage decrypts the file in the browser. The seller does not have to be online when the buyer unlocks it.

## How it works

1. The seller encrypts a file once (AES-256-GCM) with a content key `K`.
2. A pool of Lightning invoices is minted ahead of time. For each invoice, `K` is wrapped with a key derived from that invoice's preimage, and the wrapped key is published next to the invoice's payment hash.
3. A static HTML page holds the ciphertext, the invoices and the wrapped keys. Host it anywhere (IPFS, Blossom, a static host, an email attachment).
4. The buyer pays any invoice from any Lightning wallet, pastes the preimage, and the page unwraps `K` and decrypts the file locally.
5. When the seller's machine next wakes up, `rotate` notices paid or expired invoices and tops the pool back up.

Public data alone (payment hashes, ciphertext) never yields `K`; tampered ciphertext fails closed. These properties are covered by the tests.

There is also `l402/`, a small L402 server (macaroon + preimage, aperture-style, tested against Lightning Labs' `lnget`) with a tunnel watchdog that recovers after the host sleeps.

## Quickstart (offline demo, 30 seconds)

Needs Node 20+. No wallet, no network, no `npm install`.

```sh
git clone https://github.com/HexboxTools/sleepy-checkout
cd sleepy-checkout
./run.sh            # or: npm test
```

This seals a sample file, mints a dry-run invoice pool with locally generated preimages, "sells" one, rotates the pool, builds the offline unlock page, and unlocks it both in a sandboxed browser context and with the buyer CLI (`checkout/unlock.cjs`). Expected last line: `11 passed, 0 failed`.

## Running for real

Needs a Spark wallet seed (or adapt `checkout/pool.mjs` / `l402/server.mjs` to an NWC wallet).

```sh
mkdir -p l402/secret && chmod 700 l402/secret
# put your seed in l402/secret/seed.txt (chmod 600), or set WALLET_SEED_FILE
export LN_ADDRESS=you@your-wallet.example
./run.sh server              # installs l402 deps, creates root.key, serves on 127.0.0.1:8796
```

Checkout pool:

```sh
cd checkout
node pool.mjs            # mint the invoice pool
node build-unlock.mjs    # build the static unlock page
./rotate.sh              # run on wake (or use watch-rotate.mjs) to refill the pool
```

The optional data endpoints in `l402/` (`/v1/funding`, `/v1/trials`, `/v1/traction`) load plugins from `l402/plugins/`, which are not included. Add your own module or remove the routes.

## Layout

| Path | What |
|---|---|
| `checkout/lib.mjs` | Key derivation, wrapping, sealing |
| `checkout/pool.mjs` | Mint / rotate the invoice pool |
| `checkout/build-unlock.mjs`, `unlock-core.js` | Static, self-contained unlock page |
| `checkout/unlock.cjs` | Buyer-side CLI unlock |
| `checkout/tests/test.mjs` | Offline test suite |
| `l402/` | L402 server, tunnel scripts, watchdog |
| `wakewatch/` | Detects resume-from-sleep to trigger maintenance |

## Status and caveats

Early code. Read scripts before running them, and never commit your seed or `root.key` (both are in `.gitignore`).

## License

MIT
