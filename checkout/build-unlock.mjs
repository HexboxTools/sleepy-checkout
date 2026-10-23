// Builds one self-contained, offline unlock page: ciphertext + every published wrap + the decrypt code.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function buildUnlock({ meta, blob, pool }) {
  const core = fs.readFileSync(path.join(HERE, "unlock-core.js"), "utf8");
  const table = (pool?.invoices || []).filter(e => !e.dry).map(e => ({ payment_hash: e.payment_hash, wrap: e.wrap }));
  const open = (pool?.invoices || []).filter(e => e.state === "open" && !e.dry && e.bolt11).map(e => ({ n: e.n, bolt11: e.bolt11, sats: e.sats, expires_at: e.expires_at }));
  const data = JSON.stringify({ meta, pool: table, open }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unlock: ${esc(meta.title)}</title>
<style>body{font:15px/1.45 system-ui,sans-serif;max-width:640px;margin:2em auto;padding:0 1em;color:#222}textarea,input{width:100%;box-sizing:border-box;font:13px ui-monospace,monospace;padding:.5em}button{font:inherit;padding:.5em 1em;margin:.5em .5em 0 0}code{font-size:12px;word-break:break-all}#msg{margin-top:1em;white-space:pre-wrap}.bad{color:#a00}.ok{color:#060}details{margin-top:1.5em}small{color:#666}</style></head><body>
<h2>${esc(meta.title)}</h2>
<p>This page holds the file, encrypted. It works offline and talks to nobody. Pay one of the invoices, then paste the <b>preimage</b> your wallet shows for that payment (sometimes called "proof of payment"). The preimage turns into the key, the key opens the file.</p>
<p><small>${esc(meta.sats)} sats. ${esc(meta.license || "")}. File: ${esc(meta.filename)} (${meta.plain_bytes} bytes, sha256 <code>${meta.plain_sha256}</code>). Sold by Hexbox Tools, which is a bot.</small></p>
<label>Preimage (64 hex characters)<br><input id="pre" autocomplete="off" spellcheck="false"></label>
<p><small>Not in the list below? Also paste the invoice you paid, or the <code>hxw1:</code> code from its description.</small></p>
<textarea id="inv" rows="3" placeholder="lnbc... or hxw1:..." spellcheck="false"></textarea>
<button id="go">Unlock and save</button><span id="wl"></span>
<div id="msg"></div>
<details><summary>Invoices in this copy of the page (single-use, some may be taken)</summary><div id="open"></div></details>
<details><summary>How it works</summary><p><small>The file is AES-256-GCM encrypted with key K. Each invoice was minted from a preimage we picked, and its unlock code is K XOR SHA-256("hexbox-key-v1" || preimage). The payment hash is SHA-256(preimage), so seeing the invoice tells you nothing; paying it hands you the preimage, which is how Lightning proves payment. We don't keep the preimages. Lightning's routing nodes and Spark's operators see the preimage too, once you've paid.</small></p></details>
<script>${core}</script>
<script>
var D=${data};
var BLOB=HXP.b64dec("${blob.toString("base64")}");
function $(i){return document.getElementById(i)}
function say(t,c){var m=$("msg");m.textContent=t;m.className=c||""}
async function go(pre){
  try{
    var inv=$("inv").value.trim(), o={preimage:pre||$("pre").value,pool:D.pool,meta:D.meta,blob:BLOB};
    if(/^hxw1:/i.test(inv)) o.wrap=inv; else if(inv) o.invoice=inv;
    var r=await HXP.unlock(o), got=HXP.b2hex(await HXP.sha256(r.bytes));
    if(got!==D.meta.plain_sha256) throw new Error("decrypted, but the checksum is off. Keep your preimage and ask the seller.");
    var a=document.createElement("a");a.href=URL.createObjectURL(new Blob([r.bytes]));a.download=D.meta.filename;document.body.appendChild(a);a.click();
    say("Unlocked ("+r.how+"). Saving "+D.meta.filename+". Checksum matches.","ok");
  }catch(e){say(e.message,"bad")}
}
$("go").onclick=function(){go()};
var od=$("open");
if(!D.open.length) od.textContent="None listed here. Check the seller's latest note.";
D.open.forEach(function(e){var p=document.createElement("p");p.innerHTML="<b>#"+e.n+"</b> "+e.sats+" sats, expires "+e.expires_at.slice(0,10)+"<br><code></code>";p.querySelector("code").textContent=e.bolt11;
  if(window.webln){var b=document.createElement("button");b.textContent="Pay #"+e.n+" with WebLN";b.onclick=async function(){try{await webln.enable();var r=await webln.sendPayment(e.bolt11);$("pre").value=r.preimage;go(r.preimage)}catch(x){say("WebLN: "+x.message,"bad")}};p.appendChild(b)}
  od.appendChild(p)});
</script></body></html>
`;
}
