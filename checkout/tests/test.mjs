// Offline tests: locally generated preimages only, no Spark, no network.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import vm from "node:vm";
import { execFileSync } from "node:child_process"; import { createRequire } from "node:module"; import crypto from "node:crypto";
const require = createRequire(import.meta.url);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hxp-"));
const SRC = "./plugins/shop/products/RenderLadder-1.0.0.zip";
fs.writeFileSync(path.join(tmp, "catalog.json"), JSON.stringify({ "render-ladder": { title: "Render Ladder 1.0.0 (Blender add-on)", file: SRC, sats: 2100, license: "GPL-3.0-or-later" } }));
process.env.HXP_ROOT = tmp; process.env.HXP_CATALOG = path.join(tmp, "catalog.json");
const L = await import("../lib.mjs"), POOL = await import("../pool.mjs"), HXP = require("../unlock-core.js");
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, "-", e.message); } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || "neq"}: ${a} != ${b}`); };
const throws = async (fn, re) => { try { await fn(); } catch (e) { if (re && !re.test(e.message)) throw new Error("wrong error: " + e.message); return; } throw new Error("did not throw"); };
const plain = fs.readFileSync(SRC), id = "render-ladder";
const F = n => path.join(tmp, n);
// bech32 encoder, to build realistic BOLT11 strings for the parser
const CH = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const polymod = v => { const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]; let c = 1; for (const x of v) { const b = c >> 25; c = ((c & 0x1ffffff) << 5) ^ x; for (let i = 0; i < 5; i++) if ((b >> i) & 1) c ^= G[i]; } return c; };
const hrpx = h => [...h].map(c => c.charCodeAt(0) >> 5).concat([0], [...h].map(c => c.charCodeAt(0) & 31));
const to5 = b => { let acc = 0, bits = 0; const o = []; for (const x of b) { acc = (acc << 8) | x; bits += 8; while (bits >= 5) { bits -= 5; o.push((acc >> bits) & 31); } } if (bits) o.push((acc << (5 - bits)) & 31); return o; };
const tag = (ty, words) => [ty, words.length >> 5, words.length & 31, ...words];
function fakeBolt11(phHex, memo) {
  const data = [0, 0, 0, 0, 0, 0, 0, ...tag(1, to5(Buffer.from(phHex, "hex"))), ...tag(13, to5(Buffer.from(memo))), ...new Array(104).fill(0)];
  const hrp = "lnbc21u", pm = polymod(hrpx(hrp).concat(data, [0, 0, 0, 0, 0, 0])) ^ 1, cs = [0, 1, 2, 3, 4, 5].map(i => (pm >> (5 * (5 - i))) & 31);
  return hrp + "1" + data.concat(cs).map(w => CH[w]).join("");
}

let meta, K, minted, dryPre;
await t("seal: blob decrypts with K (node), keycheck matches, key file is 0600", async () => {
  meta = POOL.cmdSeal(id);
  K = Buffer.from(fs.readFileSync(F("secret/render-ladder.key"), "utf8").trim(), "hex");
  eq(L.open(K, fs.readFileSync(F("public/render-ladder.hxp"))).equals(plain), true, "roundtrip");
  eq(meta.keycheck, L.keycheck(K)); eq(fs.statSync(F("secret/render-ladder.key")).mode & 0o777, 0o600, "mode");
  eq(meta.blob_bytes, plain.length + 32, "overhead");
});
await t("seal refuses to replace an existing key", () => throws(() => POOL.cmdSeal(id), /orphan/));
await t("dry mint 3: wraps/memos present, preimages in range, not in public files", async () => {
  minted = await POOL.cmdMint(id, 3, { dry: true });
  dryPre = JSON.parse(fs.readFileSync(F("secret/render-ladder.dry-preimages.json")));
  eq(minted.length, 3);
  const pub = fs.readFileSync(F("public/render-ladder.pool.json"), "utf8");
  for (const e of minted) { const p = dryPre[e.payment_hash]; eq(BigInt("0x" + p) < L.N && BigInt("0x" + p) > 0n, true, "range"); eq(pub.includes(p), false, "preimage leaked"); eq(e.memo.includes("hxw1:" + e.wrap), true, "memo"); eq(e.memo.length < 639, true, "memo len"); }
});
await t("WebCrypto core unlocks every invoice via the pool table (cross-implementation)", async () => {
  const pool = JSON.parse(fs.readFileSync(F("public/render-ladder.pool.json"))).invoices, blob = new Uint8Array(fs.readFileSync(F("public/render-ladder.hxp")));
  for (const e of minted) { const r = await HXP.unlock({ preimage: dryPre[e.payment_hash], pool, meta, blob }); eq(Buffer.from(r.bytes).equals(plain), true); eq(r.how, "built-in list"); }
});
await t("unlock via hxw1 code, via BOLT11 memo, uppercase and base64 preimages", async () => {
  const blob = new Uint8Array(fs.readFileSync(F("public/render-ladder.hxp"))), e = minted[1], pre = dryPre[e.payment_hash];
  eq(Buffer.from((await HXP.unlock({ preimage: pre.toUpperCase(), wrap: "hxw1:" + e.wrap, meta, blob })).bytes).equals(plain), true);
  const inv = fakeBolt11(e.payment_hash, e.memo), d = HXP.bolt11(inv); eq(d.paymentHash, e.payment_hash); eq(d.memo, e.memo);
  const r = await HXP.unlock({ preimage: Buffer.from(pre, "hex").toString("base64"), invoice: "lightning:" + inv.toUpperCase(), meta, blob }); eq(r.how, "invoice memo"); eq(Buffer.from(r.bytes).equals(plain), true);
});
await t("wrong preimage for an invoice is rejected (hash mismatch), wrong pair fails keycheck", async () => {
  const blob = new Uint8Array(fs.readFileSync(F("public/render-ladder.hxp"))), a = minted[0], b = minted[1];
  await throws(() => HXP.unlock({ preimage: dryPre[a.payment_hash], invoice: fakeBolt11(b.payment_hash, b.memo), meta, blob }), /hash mismatch/);
  await throws(() => HXP.unlock({ preimage: dryPre[a.payment_hash], wrap: b.wrap, meta, blob }), /wrong key/);
  await throws(() => HXP.unlock({ preimage: crypto.randomBytes(32).toString("hex"), pool: [], meta, blob }), /no unlock code/);
});
await t("public data alone does not give K (payment_hash is not the KDF)", async () => {
  for (const e of minted) { const naive = L.xor32(Buffer.from(e.wrap, "hex"), Buffer.from(e.payment_hash, "hex")); eq(naive.equals(K), false); eq(L.kdf(Buffer.from(dryPre[e.payment_hash], "hex")).toString("hex") === e.payment_hash, false); }
  eq(new Set(minted.map(e => e.wrap)).size, 3, "distinct wraps");
});
await t("tampered ciphertext fails closed (GCM tag)", async () => {
  const blob = new Uint8Array(fs.readFileSync(F("public/render-ladder.hxp"))); blob[100] ^= 1; const e = minted[0];
  await throws(() => HXP.unlock({ preimage: dryPre[e.payment_hash], wrap: e.wrap, meta, blob }));
});
await t("rotate: sold + expired detected, pool topped back up to target", async () => {
  const pf = F("public/render-ladder.pool.json"), pool = JSON.parse(fs.readFileSync(pf)); pool.invoices[1].expires_at = new Date(Date.now() - 1000).toISOString(); fs.writeFileSync(pf, JSON.stringify(pool));
  const sold = minted[0].payment_hash;
  const m = await POOL.cmdRotate(id, { target: 3, dry: true, statusOf: async e => (e.payment_hash === sold ? "TRANSFER_COMPLETED" : "INVOICE_CREATED") });
  const after = JSON.parse(fs.readFileSync(pf)).invoices;
  eq(m.length, 2, "minted"); eq(after.filter(e => e.state === "open").length, 3, "open"); eq(after[0].state, "sold"); eq(after[1].state, "expired");
  const m2 = await POOL.cmdRotate(id, { target: 3, dry: true, statusOf: async () => "INVOICE_CREATED" }); eq(m2.length, 0, "idempotent");
});
await t("offline HTML: embedded blob + table + core unlock in a sandbox", async () => {
  // give the page a live-looking pool entry by reusing a dry entry with dry=false
  const pf = F("public/render-ladder.pool.json"), pool = JSON.parse(fs.readFileSync(pf)); pool.invoices[2].dry = false; pool.invoices[2].bolt11 = fakeBolt11(pool.invoices[2].payment_hash, pool.invoices[2].memo); fs.writeFileSync(pf, JSON.stringify(pool));
  const { html, html_bytes } = POOL.cmdOffer(id), s = fs.readFileSync(html, "utf8");
  const D = JSON.parse(/var D=(.*);\n/.exec(s)[1]), b64 = /HXP\.b64dec\("([^"]+)"\)/.exec(s)[1];
  const core = /<script>([\s\S]*?)<\/script>/.exec(s)[1], ctx = { crypto: globalThis.crypto, TextEncoder, TextDecoder, atob, Uint8Array, module: undefined };
  vm.createContext(ctx); vm.runInContext(core + "\nthis.HXP=HXP;", ctx);
  const e = pool.invoices[2], r = await ctx.HXP.unlock({ preimage: dryPre[e.payment_hash], pool: D.pool, meta: D.meta, blob: ctx.HXP.b64dec(b64) });
  eq(Buffer.from(r.bytes).equals(plain), true); eq(D.open.length, 1, "open listed"); eq(s.includes(dryPre[e.payment_hash]), false, "no preimage in html");
  console.log("     html", html_bytes, "bytes");
});
await t("buyer CLI unlock.cjs end-to-end", async () => {
  const e = minted[2] ?? minted[0], out = F("out.zip");
  const o = execFileSync("node", [path.resolve("unlock.cjs"), F("public/render-ladder.hxp"), F("public/render-ladder.meta.json"), dryPre[minted[0].payment_hash], "hxw1:" + minted[0].wrap, out]).toString();
  eq(fs.readFileSync(out).equals(plain), true); eq(/sha256 ok/.test(o), true);
});
console.log(`\n${pass} passed, ${fail} failed (tmp ${tmp})`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
