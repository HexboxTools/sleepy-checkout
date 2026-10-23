// Real-browser check of the unlock page: headless Chrome, file://, no network. Dry preimages only.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { execFileSync } from "node:child_process";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hxpb-"));
fs.writeFileSync(path.join(tmp, "catalog.json"), JSON.stringify({ "render-ladder": { title: "Render Ladder 1.0.0 (Blender add-on)", file: "./plugins/shop/products/RenderLadder-1.0.0.zip", sats: 2100, license: "GPL-3.0-or-later" } }));
process.env.HXP_ROOT = tmp; process.env.HXP_CATALOG = path.join(tmp, "catalog.json");
const POOL = await import("../pool.mjs");
POOL.cmdSeal("render-ladder"); const [a, b] = await POOL.cmdMint("render-ladder", 2, { dry: true });
const pre = JSON.parse(fs.readFileSync(path.join(tmp, "secret/render-ladder.dry-preimages.json")));
const pf = path.join(tmp, "public/render-ladder.pool.json"), pool = JSON.parse(fs.readFileSync(pf)); pool.invoices[0].dry = false; fs.writeFileSync(pf, JSON.stringify(pool));
const { html } = POOL.cmdOffer("render-ladder");
const run = (preimage, extra) => {
  const page = fs.readFileSync(html, "utf8").replace("</body>", `<script>HTMLAnchorElement.prototype.click=function(){};$("pre").value=${JSON.stringify(preimage)};$("inv").value=${JSON.stringify(extra || "")};go().then(function(){document.title="DONE:"+$("msg").className+":"+$("msg").textContent})</script></body>`);
  const f = path.join(tmp, "t.html"); fs.writeFileSync(f, page);
  const dom = execFileSync("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--user-data-dir=" + path.join(tmp, "prof"), "--timeout=6000", "--dump-dom", "file://" + f], { stdio: ["ignore", "pipe", "ignore"], timeout: 40000 }).toString();
  return /<title>(DONE:[^<]*)<\/title>/.exec(dom)?.[1] || "no result";
};
const r1 = run(pre[a.payment_hash]);            // in the built-in table
const r2 = run(pre[b.payment_hash], "hxw1:" + b.wrap); // dry entry is not in the page table, so needs the code
const r3 = run(pre[b.payment_hash]);            // ...and without it, a clear error
console.log(r1); console.log(r2); console.log(r3);
const ok = /^DONE:ok:Unlocked \(built-in list\)/.test(r1) && /^DONE:ok:Unlocked \(wrap given\)/.test(r2) && /^DONE:bad:no unlock code/.test(r3);
console.log(ok ? "browser check PASS" : "browser check FAIL"); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(ok ? 0 : 1);
