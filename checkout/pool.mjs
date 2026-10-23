#!/usr/bin/env node
// Preimage-as-key checkout: seal a product once, keep a pool of pre-minted Spark invoices whose
// preimages unwrap the content key. Receive-only: nothing here ever pays or sends.
//   node pool.mjs seal   <product>                      encrypt once (refuses to replace an existing key)
//   node pool.mjs mint   <product> <n> [--dry] [--days D] [--sats S]
//   node pool.mjs check  <product> [--dry]               mark sold / expired (Spark status + wall clock)
//   node pool.mjs rotate <product> [--target N] [--min-days D] [--dry]   check, then top up open invoices
//   node pool.mjs offer  <product>                      rebuild public/unlock-<product>.html + print open invoices
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { newPreimage, makeWrap, keycheck, seal, sha256, memoFor } from "./lib.mjs";
import { buildUnlock } from "./build-unlock.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.HXP_ROOT || HERE; // tests point this at a temp dir
const CATALOG = process.env.HXP_CATALOG || "./catalog.json";
const SHOP_DIR = path.dirname(CATALOG);
const PAID_RE = /TRANSFER_COMPLETED|LIGHTNING_PAYMENT_RECEIVED|PAYMENT_PREIMAGE_RECOVERED|TRANSFER_CREATED/;
const DEAD_RE = /FAILED/;
const P = id => ({
  key: path.join(ROOT, "secret", `${id}.key`),
  dryPre: path.join(ROOT, "secret", `${id}.dry-preimages.json`),
  blob: path.join(ROOT, "public", `${id}.hxp`),
  meta: path.join(ROOT, "public", `${id}.meta.json`),
  pool: path.join(ROOT, "public", `${id}.pool.json`),
  html: path.join(ROOT, "public", `unlock-${id}.html`),
  log: path.join(ROOT, "pool.log"),
});
const rd = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : d);
const wr = (f, o, mode) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + ".tmp"; fs.writeFileSync(t, JSON.stringify(o, null, 2) + "\n", mode ? { mode } : undefined); fs.renameSync(t, f); };
const log = (id, ...a) => { const l = `${new Date().toISOString()} ${id} ${a.join(" ")}`; console.error(l); fs.appendFileSync(P(id).log, l + "\n"); };
const arg = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : d; };
const flag = name => process.argv.includes(name);

function product(id) {
  const c = rd(CATALOG, {})[id];
  if (!c) throw new Error(`no product ${id} in ${CATALOG}`);
  return { id, title: c.title, sats: c.sats, license: c.license, file: path.resolve(SHOP_DIR, c.file) };
}

export function cmdSeal(id) {
  const p = P(id), pr = product(id);
  if (fs.existsSync(p.key)) throw new Error(`${p.key} exists; a new key would orphan every published wrap. Delete it by hand only if no invoice was ever published.`);
  const plain = fs.readFileSync(pr.file), K = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(p.key), { recursive: true, mode: 0o700 });
  fs.writeFileSync(p.key, K.toString("hex") + "\n", { mode: 0o600 });
  const blob = seal(K, plain);
  fs.mkdirSync(path.dirname(p.blob), { recursive: true });
  fs.writeFileSync(p.blob, blob);
  const meta = { scheme: "hxp1", product: id, title: pr.title, sats: pr.sats, license: pr.license, filename: path.basename(pr.file),
    plain_sha256: sha256(plain).toString("hex"), plain_bytes: plain.length, blob_sha256: sha256(blob).toString("hex"), blob_bytes: blob.length,
    keycheck: keycheck(K), sealed_at: new Date().toISOString() };
  wr(p.meta, meta);
  log(id, "sealed", pr.file, `${plain.length}B -> ${blob.length}B`, "keycheck", meta.keycheck);
  return meta;
}

let _wallet;
async function wallet() {
  if (_wallet) return _wallet;
  const { SparkWallet } = await import("@buildonspark/spark-sdk");
  const t = setTimeout(() => { console.error("spark init watchdog 150s, exiting"); process.exit(3); }, 150e3);
  const { wallet } = await SparkWallet.initialize({ mnemonicOrSeed: fs.readFileSync((process.env.WALLET_SEED_FILE || "./secret/seed.txt"), "utf8").trim(), options: { network: "MAINNET" } });
  clearTimeout(t);
  return (_wallet = wallet);
}

// The crux: SparkWallet.createLightningInvoice() draws the preimage itself and never returns it, but the
// public LightningService.createLightningInvoiceWithPreImage() takes ours, then splits it to the operators
// (store_preimage_share_v2) exactly like a normal invoice, so it still settles while we're frozen.
async function sparkMint({ sats, memo, expirySeconds, preimage }) {
  const w = await wallet();
  const invoiceCreator = (amountSats, paymentHash, memo2, receiverIdentityPubkey, descriptionHash) =>
    w.validateAndCreateLightningInvoice({ amountSats, paymentHashHex: Buffer.from(paymentHash).toString("hex"), memo: memo2, expirySeconds,
      includeSparkAddress: false, includeSparkInvoice: false, receiverIdentityPubkey, descriptionHash });
  const r = await w.lightningService.createLightningInvoiceWithPreImage({ invoiceCreator, amountSats: sats, memo, preimage: new Uint8Array(preimage) });
  return { id: r.id, bolt11: r.invoice.encodedInvoice, payment_hash: r.invoice.paymentHash, expires_at: r.invoice.expiresAt || null, status: String(r.status) };
}

export async function cmdMint(id, n, { dry = false, days = 30, sats } = {}) {
  const p = P(id), pr = product(id);
  if (!fs.existsSync(p.key)) throw new Error("seal first");
  const K = Buffer.from(fs.readFileSync(p.key, "utf8").trim(), "hex");
  const pool = rd(p.pool, { product: id, scheme: "hxp1", invoices: [] });
  const dryPre = dry ? rd(p.dryPre, {}) : null;
  const price = Number(sats ?? pr.sats), expirySeconds = Math.round(days * 86400);
  const out = [];
  for (let i = 0; i < n; i++) {
    const pre = newPreimage(), wrap = makeWrap(K, pre), ph = sha256(pre).toString("hex");
    const memo = memoFor(pr.title.replace(/ \(.*\)$/, ""), wrap);
    let inv;
    if (dry) inv = { id: "dry-" + ph.slice(0, 12), bolt11: null, payment_hash: ph, expires_at: new Date(Date.now() + expirySeconds * 1e3).toISOString(), status: "DRY" };
    else inv = await sparkMint({ sats: price, memo, expirySeconds, preimage: pre });
    if (inv.payment_hash !== ph) throw new Error(`payment hash mismatch from SSP: ${inv.payment_hash} != ${ph}`);
    if (dry) dryPre[ph] = pre.toString("hex"); // test only; live preimages are never written down
    const e = { n: pool.invoices.length + 1, request_id: inv.id, payment_hash: ph, bolt11: inv.bolt11, sats: price, wrap, memo,
      created_at: new Date().toISOString(), expires_at: inv.expires_at || new Date(Date.now() + expirySeconds * 1e3).toISOString(), state: "open", dry };
    pool.invoices.push(e); out.push(e);
    wr(p.pool, pool); if (dry) wr(p.dryPre, dryPre, 0o600);
    log(id, "minted", e.n, dry ? "DRY" : "LIVE", e.request_id, ph.slice(0, 16), `${price} sats`, "exp", e.expires_at);
  }
  return out;
}

export async function cmdCheck(id, { dry = false, statusOf } = {}) {
  const p = P(id), pool = rd(p.pool, { invoices: [] }), now = Date.now(), changed = [];
  for (const e of pool.invoices) {
    if (e.state !== "open") continue;
    let st = null;
    try { st = statusOf ? await statusOf(e) : (e.dry || dry) ? null : String((await (await wallet()).getLightningReceiveRequest(e.request_id))?.status || ""); }
    catch (err) { log(id, "status-err", e.n, err.message); }
    e.last_status = st || e.last_status || null; e.checked_at = new Date().toISOString();
    if (st && PAID_RE.test(st) && !DEAD_RE.test(st)) { e.state = "sold"; e.sold_seen_at = e.checked_at; changed.push(e); log(id, "SOLD", e.n, e.request_id, st, `${e.sats} sats`); }
    else if (new Date(e.expires_at).getTime() < now) { e.state = "expired"; changed.push(e); log(id, "expired", e.n, st || "-"); }
  }
  wr(p.pool, pool);
  return changed;
}

export async function cmdRotate(id, { target = 3, minDays = 7, dry = false, days = 30, statusOf } = {}) {
  await cmdCheck(id, { dry, statusOf });
  const p = P(id), pool = rd(p.pool, { invoices: [] }), soon = Date.now() + minDays * 86400e3;
  // Invoices close to expiry stay listed (still payable) but don't count toward the target.
  const fresh = pool.invoices.filter(e => e.state === "open" && new Date(e.expires_at).getTime() > soon).length;
  const need = Math.max(0, target - fresh);
  const minted = need ? await cmdMint(id, need, { dry, days }) : [];
  log(id, "rotate", `fresh=${fresh}`, `minted=${minted.length}`, `target=${target}`);
  return minted;
}

export function cmdOffer(id) {
  const p = P(id), meta = rd(p.meta), pool = rd(p.pool, { invoices: [] });
  const html = buildUnlock({ meta, blob: fs.readFileSync(p.blob), pool });
  fs.writeFileSync(p.html, html);
  const open = pool.invoices.filter(e => e.state === "open" && !e.dry);
  return { html: p.html, html_bytes: Buffer.byteLength(html), open: open.map(e => ({ n: e.n, sats: e.sats, expires_at: e.expires_at, bolt11: e.bolt11 })) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd, id, n] = process.argv.slice(2);
  const dry = flag("--dry"), days = Number(arg("--days", 30));
  try {
    let r;
    if (cmd === "seal") r = cmdSeal(id);
    else if (cmd === "mint") r = await cmdMint(id, Number(n || 1), { dry, days, sats: arg("--sats") });
    else if (cmd === "check") r = await cmdCheck(id, { dry });
    else if (cmd === "rotate") r = await cmdRotate(id, { target: Number(arg("--target", 3)), minDays: Number(arg("--min-days", 7)), dry, days });
    else if (cmd === "offer") r = cmdOffer(id);
    else { console.error(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 9).join("\n")); process.exit(2); }
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  } catch (e) { console.error("error:", e.message); process.exit(1); }
}
