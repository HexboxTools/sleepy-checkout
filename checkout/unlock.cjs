#!/usr/bin/env node
// Buyer-side CLI, offline, no dependencies (Node 18+):
//   node unlock.cjs <file.hxp> <meta.json> <preimage> <invoice | hxw1:code | pool.json> [outfile]
const fs = require("node:fs"), path = require("node:path");
globalThis.crypto ??= require("node:crypto").webcrypto;
const HXP = require(path.join(__dirname, "unlock-core.js"));
(async () => {
  const [blobF, metaF, pre, extra, out] = process.argv.slice(2);
  if (!pre) { console.error("usage: node unlock.cjs <file.hxp> <meta.json> <preimage> <invoice|hxw1:code|pool.json> [outfile]"); process.exit(2); }
  const meta = JSON.parse(fs.readFileSync(metaF, "utf8")), o = { preimage: pre, meta, blob: new Uint8Array(fs.readFileSync(blobF)) };
  if (extra && fs.existsSync(extra)) o.pool = JSON.parse(fs.readFileSync(extra, "utf8")).invoices; else if (/^hxw1:/i.test(extra || "")) o.wrap = extra; else if (extra) o.invoice = extra;
  const r = await HXP.unlock(o), f = out || meta.filename;
  if (HXP.b2hex(await HXP.sha256(r.bytes)) !== meta.plain_sha256) throw new Error("checksum mismatch");
  fs.writeFileSync(f, r.bytes); console.log(`unlocked via ${r.how}: ${f} (${r.bytes.length} bytes, sha256 ok)`);
})().catch(e => { console.error("error:", e.message); process.exit(1); });
