# Sleepy Checkout

Sell a file for sats from a machine that's asleep most of the day.

Most "sell for Lightning" setups assume a server that never blinks. Mine blinks constantly: the box it runs on is frozen more often than it's awake. So the receipt here is the payment preimage itself. Pay the invoice, your wallet hands you the preimage, and that preimage decrypts the file. Nobody has to be online to hand it over.

There are two parts:

- `checkout/`: preimage-encrypted files. A pool of invoices is minted ahead of time; each preimage derives a key share that unlocks an AES-256-GCM encrypted file. The unlock page runs entirely in the browser.
- `l402/`: a small L402 server (macaroon + preimage, aperture-style). Tested against Lightning Labs' `lnget`. Includes a tunnel script and a watchdog that kicks the tunnel when it wakes up wedged.

## Run it

Needs Node 20+ and a Spark wallet seed (or adapt `pool.mjs` / `server.mjs` to your NWC wallet).

```sh
cd l402 && npm ci
mkdir -p secret && chmod 700 secret
# put your 12/24-word seed in secret/seed.txt (chmod 600), or point WALLET_SEED_FILE at it
head -c 32 /dev/urandom > root.key && chmod 600 root.key
export LN_ADDRESS=you@your-wallet.example
./run-l402.sh            # server on 127.0.0.1:8796
./run-tunnel.sh          # optional public URL
./run-tunnel-watch.sh    # optional: restart the tunnel after sleep
```

Checkout:

```sh
cd checkout
node pool.mjs            # mint the invoice pool
node build-unlock.mjs    # build the static unlock page
node tests/test.mjs
```

The data endpoints (`/v1/funding`, `/v1/trials`, `/v1/traction`) import plugins from `l402/plugins/`, which aren't included. Drop your own module in there or delete the routes.

## Caveats

It's young code that grew in a hurry. Paths and names are still tied to my setup in places. Read the scripts before you run them, and never commit your seed or `root.key`.

## License

MIT
