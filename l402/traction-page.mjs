// Oct 17: browser checkout page for the launch traction check. Same /v1/web/* session flow as /try, kind:"traction".
// Oct 17 4:30 AM: free saved example (traction-sample.json, read once at server start) rendered server-side in the
// same rows the paid result uses. tractionRows() is shared: it runs here for the example and is inlined (toString)
// into the page script for the paid result, so both layouts stay identical. Plain ES5, no regex/backticks inside.
export function tractionRows(r) {
  r = r || {};
  var so = r.scoredOn || {}, hn = r.hackerNews || {}, rd = r.reddit || {}, gh = r.github || {}, np = r.npm || {};
  var n = function (v) { return v == null ? "\u2013" : Number(v).toLocaleString("en-US"); };
  var rows = [], links = [], top = (gh.top || [])[0];
  rows.push(["HN points on stories linking it", n(so.hnPoints) + (hn.linkedStories != null ? " across " + n(hn.linkedStories) + (hn.linkedStories === 1 ? " story" : " stories") : "")]);
  if (hn.stories != null) rows.push(["HN stories mentioning the name", n(hn.stories) + (hn.showHN ? " (" + hn.showHN + " Show HN)" : "")]);
  rows.push(["Reddit posts linking it, 30 days", n(so.reddit30d)]);
  if (rd.posts30d != null) rows.push(["Reddit posts mentioning the name, 30 days", n(rd.posts30d) + (rd.capped ? " (search caps around 50)" : "")]);
  rows.push(["GitHub stars", so.githubStars != null ? n(so.githubStars) + (so.githubBasis ? " (" + so.githubBasis + ")" : "") : "no repo found that belongs to it"]);
  if (np.package) rows.push(["npm weekly downloads", n(np.weeklyDownloads) + " for package " + np.package + (np.note ? " (" + np.note + ")" : "")]);
  if (hn.bestLinked) links.push(["Best HN story linking it: " + hn.bestLinked.title + " (" + n(hn.bestLinked.points) + " points)", hn.bestLinked.link]);
  if (top && so.githubStars != null) links.push(["Repo: " + top.repo, top.url]);
  return { input: (r.query && r.query.input) || "", score: r.tractionScore != null ? String(r.tractionScore) : "?", rows: rows, links: links };
}
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const okHref = h => /^https:\/\//.test(String(h || ""));
export function sampleHtml(sample, price = 21) {
  const r = sample && sample.report; if (!r || !r.scoredOn) return "";
  const t = tractionRows(r), so = r.scoredOn, at = new Date(sample.checkedAt || r.checkedAt);
  const when = isNaN(at) ? "" : at.toLocaleString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "") + " UTC";
  const n = v => Number(v).toLocaleString("en-US");
  const miss = so.hnPoints != null && so.githubStars != null && so.githubStars >= 50 * Math.max(1, so.hnPoints);
  const cap = so.hnPoints != null && so.githubStars != null ? `${n(so.hnPoints)} points on Hacker News, ${n(so.githubStars)} stars on GitHub${so.reddit30d != null ? `, ${n(so.reddit30d)} Reddit posts linking it in 30 days` : ""}.${miss ? " Going by points alone, you'd have called it a miss." : ""}` : "";
  return `<section id="s-example" class="card" aria-label="Example result">
<p class="small mut" style="margin:0"><b>Example, not your result.</b> A real check, run once on ${esc(when)} and saved here. It isn't refreshed; yours runs fresh when you pay.</p>
<p class="small mut" style="margin:6px 0 0">Checked: <span id="xurl">${esc(t.input)}</span></p>
<div class="score" id="xscore">${esc(t.score)}</div><p class="small mut" style="margin-top:0">traction score out of 100</p>
<table id="xt">${t.rows.map(([l, v]) => `<tr><td>${esc(l)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
${t.links.filter(([, h]) => okHref(h)).map(([l, h]) => `<p class="small"><a href="${esc(h)}" rel="noopener noreferrer" target="_blank">${esc(l)}</a></p>`).join("\n")}
${cap ? `<p class="small">${esc(cap)}</p>` : ""}
<p class="small mut">Full JSON for this example, free: <a href="/v1/traction/sample">/v1/traction/sample</a></p>
<p class="small" style="margin:14px 0 0"><b>That result is someone else&#39;s launch.</b> Yours is not free — it runs fresh when you pay.</p>
<p class="row" style="margin-top:10px"><button type="button" id="exgo">Check yours for ${esc(String(price))} sats</button></p>
</section>`;
}
// Oct 17 R44: Open Graph / Twitter tags so Nostr clients (Amethyst, Primal, Damus) and others render a link preview.
// baseUrl = public https origin (server passes base.url); card = true when /traction/card.png has a file to serve.
export function ogTags({ title, description, baseUrl, card }) {
  const b = /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(String(baseUrl || "")) ? String(baseUrl) : "";
  const m = (attr, k, v) => `<meta ${attr}="${esc(k)}" content="${esc(v)}">`;
  const t = [m("property", "og:type", "website"), m("property", "og:site_name", "Hexbox Tools"), m("property", "og:title", title), m("property", "og:description", description)];
  if (b) t.push(m("property", "og:url", b + "/traction"));
  const img = b && card ? b + "/traction/card.png" : "";
  if (img) t.push(m("property", "og:image", img), m("property", "og:image:secure_url", img), m("property", "og:image:type", "image/png"), m("property", "og:image:width", "1200"), m("property", "og:image:height", "630"),
    m("property", "og:image:alt", "Hexbox Tools launch traction check: example result with score, Hacker News points, GitHub stars and Reddit posts"));
  t.push(m("name", "twitter:card", img ? "summary_large_image" : "summary"), m("name", "twitter:title", title), m("name", "twitter:description", description));
  if (img) t.push(m("name", "twitter:image", img));
  return t.join("\n");
}
export function tractionPageHtml({ price = 21, sample = null, baseUrl = "", card = false } = {}) {
  const ex = sampleHtml(sample, price);
  const title = "Hexbox Tools: did anyone outside HN notice your launch?";
  const description = `Type a product name, site or GitHub link, pay ${price} sats over Lightning, and see its Hacker News, Reddit, GitHub and npm traction in one place.`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${ogTags({ title, description, baseUrl, card })}
<style>
:root{--fg:#1d1d1b;--mut:#6b6b66;--line:#d9d6cf;--bg:#f6f4ef;--acc:#2f5d50;--warn:#9a3b12}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:720px;margin:0 auto;padding:32px 18px 64px}h1{font-size:1.5rem;margin:0 0 4px}h2{font-size:1.1rem;margin:22px 0 6px}
.mut{color:var(--mut)}.small{font-size:.875rem}form{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0 6px}
input[type=text]{flex:1 1 360px;padding:10px 12px;border:1px solid var(--line);border-radius:6px;font:inherit;background:#fff}
button,.btn{padding:10px 16px;border:1px solid var(--acc);background:var(--acc);color:#fff;border-radius:6px;font:inherit;cursor:pointer;text-decoration:none;display:inline-block}
button.ghost,.btn.ghost{background:transparent;color:var(--acc)}button:disabled{opacity:.5;cursor:default}
.card{background:#fff;border:1px solid var(--line);border-radius:8px;padding:18px;margin-top:18px}
.qr{width:260px;max-width:100%;margin:0 auto 12px;display:block}.qr svg{width:100%;height:auto;display:block}
textarea{width:100%;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;border:1px solid var(--line);border-radius:6px;padding:8px;resize:none;height:84px;word-break:break-all}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.err{color:var(--warn)}
.score{font-size:3rem;font-weight:700;line-height:1;margin:4px 0}
table{border-collapse:collapse;width:100%;font-size:.95rem}td{padding:6px 4px;border-bottom:1px solid var(--line);vertical-align:top}td:first-child{color:var(--mut);width:44%}
pre{background:#f1efe9;border:1px solid var(--line);border-radius:6px;padding:10px;overflow:auto;font-size:12px;max-height:360px}
footer{margin-top:40px;font-size:.85rem;color:var(--mut)}[hidden]{display:none!important}
</style></head><body><main>
<h1>Hexbox Tools</h1>
<p>Most Show HN posts get two points and vanish, and a few that stall at ten points quietly pick up a thousand stars. Points measure one afternoon. This checks whether anyone came back.</p>
<p>Type a product name, its site, or its GitHub link. For ${price} sats you get Hacker News stories that actually link it (not just mention the word), Reddit posts linking it in the last 30 days, stars on its own repo, npm weekly downloads, and a 0 to 100 score with what it was scored on.</p>
<p class="mut small">A site or GitHub link gives the cleanest answer. A bare name like "petal" will match other people's things, and the result says so.${ex ? " There's a real example under the box, so you can see what you get first." : ""}</p>

<section id="s-form">
<form id="f"><input type="text" id="u" required maxlength="200" placeholder="excalidraw.com or github.com/owner/repo" autocomplete="off" spellcheck="false"><button id="go">Check for ${price} sats</button></form>
<div id="ferr" class="err small" hidden></div>
${ex}
</section>

<section id="s-pay" class="card" hidden>
<div class="qr" id="qr"></div>
<p style="text-align:center;margin:0 0 8px"><b>${price} sats</b> <span class="mut small" id="exp"></span></p>
<textarea id="bolt" readonly aria-label="Lightning invoice"></textarea>
<div class="row"><button type="button" id="copy" class="ghost">Copy invoice</button><a id="openw" class="btn ghost" href="#">Open in wallet</a><button type="button" id="weblnbtn" class="ghost" hidden>Pay with browser wallet</button></div>
<p class="small mut" id="paystate">Waiting for payment. Any Lightning wallet works. This page updates by itself.</p>
<p class="small mut">Checking: <span id="purl"></span></p>
</section>

<section id="s-work" class="card" hidden><p><b>Paid.</b> Asking Hacker News, Reddit, GitHub and npm. Usually under ten seconds.</p></section>

<section id="s-fail" class="card" hidden>
<p class="err"><b>Paid, but that check didn't go through.</b> <span id="ferrmsg"></span></p>
<p class="small">Your payment still counts. Try a different name or link and it runs on this same payment.</p>
<form id="rf"><input type="text" id="ru" required maxlength="200" placeholder="example.com"><button>Check this</button></form>
</section>

<section id="s-exp" class="card" hidden><p>That invoice expired before it was paid, so nothing was charged.</p><button type="button" id="again1">Start over</button></section>

<section id="s-done" class="card" hidden>
<p class="small mut" id="rurl" style="margin:0"></p>
<div class="score" id="score"></div><p class="small mut" style="margin-top:0">traction score out of 100</p>
<table id="rt"></table>
<div id="links"></div>
<div class="row"><a id="dl" class="btn ghost" download="traction.json" href="#">Download JSON</a><button type="button" id="again2">Check another</button></div>
<details style="margin-top:12px"><summary class="small">Raw JSON</summary><pre id="raw"></pre></details>
</section>

<footer>Hexbox Tools. Payment is a plain Lightning invoice; no account, no email. Scripts can run the same check over L402 at <code>/v1/traction?q=</code> (<a href="/v1">API notes</a>).</footer>
</main>
<script>
(function(){
var $=function(i){return document.getElementById(i)};var sid=null,timer=null,bolt="";
var S=["s-pay","s-work","s-fail","s-exp","s-done"];
function show(id){S.forEach(function(x){$(x).hidden=(x!==id)});$("s-form").hidden=!!id;}
function ferr(m){var e=$("ferr");e.textContent=m||"";e.hidden=!m;}
function api(p,o){return fetch(p,o).then(function(r){return r.json().then(function(j){j._code=r.status;return j},function(){return{_code:r.status,error:"unexpected reply ("+r.status+")"}})})}
function post(b){return api("/v1/web/start",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)})}
function start(q){ferr("");$("go").disabled=true;
  post({kind:"traction",q:q}).then(function(j){$("go").disabled=false;
    if(j._code!==200){ferr(j.error||"couldn't make an invoice, try again in a minute");return;}
    sid=j.id;location.hash="s="+sid;if(j.bolt11)payView(j,q);else poll();
  },function(){$("go").disabled=false;ferr("network problem, try again")});}
function payView(j,q){bolt=j.bolt11;$("qr").innerHTML=j.qr_svg||"";$("bolt").value=bolt;$("openw").href="lightning:"+bolt;$("purl").textContent=q||j.url||"";
  if(j.expires){var t=new Date(j.expires);$("exp").textContent="(invoice good until "+t.toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})+")";}
  $("weblnbtn").hidden=!window.webln;show("s-pay");poll();}
function poll(){clearTimeout(timer);if(!sid)return;
  api("/v1/web/status?id="+encodeURIComponent(sid)).then(function(j){
    if(j._code===404){location.hash="";sid=null;show(null);ferr("That checkout is gone (they last 30 minutes unpaid). Start a new one.");return;}
    var st=j.state;
    if(st==="unpaid"){if($("s-pay").hidden&&j.bolt11)return payView(j);timer=setTimeout(poll,3000);return;}
    if(st==="paid"||st==="working"){show("s-work");timer=setTimeout(poll,2000);return;}
    if(st==="failed"){$("ferrmsg").textContent=j.error||"";show("s-fail");return;}
    if(st==="expired"){show("s-exp");location.hash="";return;}
    if(st==="done"){report(j.report,j.url);return;}
    timer=setTimeout(poll,5000);
  },function(){timer=setTimeout(poll,5000)});}
${tractionRows.toString()}
function row(l,v){var tr=document.createElement("tr"),a=document.createElement("td"),b=document.createElement("td");a.textContent=l;b.textContent=v;tr.appendChild(a);tr.appendChild(b);$("rt").appendChild(tr)}
function link(label,href){if(!/^https:\\/\\//.test(String(href||"")))return;var p=document.createElement("p");p.className="small";var a=document.createElement("a");a.href=href;a.rel="noopener noreferrer";a.target="_blank";a.textContent=label;p.appendChild(a);$("links").appendChild(p)}
function report(r,q){r=r||{};show("s-done");var t=tractionRows(r);$("rurl").textContent=t.input||q||"";
  $("score").textContent=t.score;$("rt").textContent="";$("links").textContent="";
  t.rows.forEach(function(x){row(x[0],x[1])});t.links.forEach(function(x){link(x[0],x[1])});
  var s=JSON.stringify(r,null,1);$("raw").textContent=s;$("dl").href=URL.createObjectURL(new Blob([s],{type:"application/json"}));}
function reset(){clearTimeout(timer);sid=null;location.hash="";$("u").value="";show(null);$("u").focus();}
$("f").addEventListener("submit",function(e){e.preventDefault();start($("u").value.trim())});
$("rf").addEventListener("submit",function(e){e.preventDefault();post({kind:"traction",q:$("ru").value.trim(),retry:sid}).then(function(j){if(j._code!==200){$("ferrmsg").textContent=j.error||"try again";return}show("s-work");poll()})});
$("copy").addEventListener("click",function(){var b=$("bolt");b.select();try{navigator.clipboard.writeText(bolt).then(function(){$("copy").textContent="Copied"},function(){document.execCommand("copy");$("copy").textContent="Copied"})}catch(e){document.execCommand("copy");$("copy").textContent="Copied"}});
$("weblnbtn").addEventListener("click",function(){var w=window.webln;if(!w)return;Promise.resolve(w.enable&&w.enable()).then(function(){return w.sendPayment(bolt)}).then(function(){$("paystate").textContent="Payment sent. Confirming…";poll()},function(e){$("paystate").textContent="Browser wallet said: "+((e&&e.message)||"cancelled")+". You can still scan or copy the invoice."})});
$("again1").addEventListener("click",reset);$("again2").addEventListener("click",reset);
var exgo=$("exgo");if(exgo)exgo.addEventListener("click",function(){$("u").focus();try{$("u").scrollIntoView({behavior:"smooth",block:"center"})}catch(e){}$("ferr").hidden=true;});
var qm=/[?&]q=([^&]*)/.exec(location.search);if(qm){try{var qv=decodeURIComponent(String(qm[1]).replace(/\\+/g," ")).trim();if(qv&&qv.length<=200)$("u").value=qv}catch(e){}}
var m=/s=([0-9a-f]{16,64})/.exec(location.hash);if(m){sid=m[1];$("s-form").hidden=true;poll();}
})();
</script></body></html>`;
}
