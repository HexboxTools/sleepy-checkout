// Oct 18 R66: browser checkout for the cross-exchange funding snapshot. Same /v1/web/* flow as /trials, kind:"funding".
// fundingView() lays out a result. It runs server-side for the saved example (funding-sample.json) and is inlined
// (toString) into the page script for the paid result, so both tables are built the same way. Plain ES5 inside it.
export const FUNDING_COINS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB", "LTC", "ADA", "AVAX", "LINK", "SUI", "HYPE"];
export function fundingView(r) {
  r = r || {};
  var sm = r.summary || {}, asOf = String(r.as_of || r.checkedAt || "");
  var NAMES = { binance: "Binance", bybit: "Bybit", okx: "OKX", bitget: "Bitget", gate: "Gate", mexc: "MEXC", kucoin: "KuCoin", deribit: "Deribit", kraken: "Kraken", hyperliquid: "Hyperliquid" };
  var nm = function (v) { v = String(v || "?"); return NAMES[v] || (v.charAt(0).toUpperCase() + v.slice(1)); };
  var pct = function (v, d) { if (v == null || !isFinite(v)) return "\u2013"; var s = Number(v).toFixed(d == null ? 4 : d); return (Number(v) > 0 ? "+" : "") + s + "%"; };
  var usd = function (v) { if (v == null || !isFinite(v) || !v) return "\u2013"; v = Number(v);
    if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B"; if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M"; return "$" + Math.round(v).toLocaleString("en-US"); };
  var when = function (row) { var t = String(row.next_funding || "");
    if (!t) return row.note && String(row.note).indexOf("continuous") >= 0 ? "continuous" : row.interval_h === 1 ? "hourly" : "\u2013";
    var hm = t.slice(11, 16) + " UTC"; return t.slice(0, 10) === asOf.slice(0, 10) ? hm : t.slice(5, 10) + " " + hm; };
  var venues = (r.venues || []).map(function (v) {
    return [nm(v.venue), pct(v.rate_8h_pct), pct(v.apr_pct, 2), when(v), usd(v.oi_usd), v.interval_h && v.interval_h !== 8 ? "pays every " + v.interval_h + "h, scaled to 8h" : (v.note || "")]; });
  var hi = sm.highest || {}, lo = sm.lowest || {};
  var summary = [
    ["Open-interest-weighted 8h rate", pct(sm.oi_weighted_8h_pct)],
    ["Highest", hi.venue ? nm(hi.venue) + " " + pct(hi.rate_8h_pct) : "\u2013"],
    ["Lowest", lo.venue ? nm(lo.venue) + " " + pct(lo.rate_8h_pct) : "\u2013"],
    ["Spread, highest minus lowest", sm.spread_8h_pct != null ? Number(sm.spread_8h_pct).toFixed(4) + "% per 8h, " + Number(sm.spread_apr_pct).toFixed(2) + "% a year" : "\u2013"],
    ["Open interest counted", usd(sm.total_oi_usd)],
    ["Venues where shorts pay longs", (sm.negative_venues || []).length ? (sm.negative_venues || []).map(nm).join(", ") : "none"],
    ["Exchanges that answered", String(r.venues_ok != null ? r.venues_ok : venues.length) + " of " + String((r.venues_ok != null ? r.venues_ok : venues.length) + (r.venues_failed || []).length)]];
  var failed = (r.venues_failed || []).map(function (f) { return nm(f.venue) + " (" + String(f.error || "no answer") + ")"; }).join(", ");
  if (failed) summary.push(["Didn't answer", failed]);
  var vo = r.vol; var vn = function (v) { return v == null || !isFinite(v) ? "\u2013" : Number(v).toFixed(1) + "%"; };
  if (vo && !vo.error && vo.dvol != null) {
    summary.push(["Implied vol (Deribit DVOL)", vn(vo.dvol) + " a year, " + (vo.dvol_24h_change >= 0 ? "+" : "") + Number(vo.dvol_24h_change).toFixed(1) + " pts in 24h; about " + Number(vo.implied_daily_move_pct).toFixed(1) + "% a day"]);
    summary.push(["Realised vol, 7 and 30 days", vn(vo.realised_7d) + " and " + vn(vo.realised_30d)]);
    if (vo.implied_minus_realised_30d != null) summary.push(["Implied minus realised (30d)", (vo.implied_minus_realised_30d > 0 ? "+" : "") + Number(vo.implied_minus_realised_30d).toFixed(1) + " pts"]); }
  return { coin: String(r.coin || ""), asOf: asOf, head: ["Venue", "8h rate", "APR", "Next funding", "Open interest", ""], venues: venues, summary: summary };
}
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const utc = iso => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "") + " UTC"; };
const tableHtml = (v, id) => `<table class="v" id="${id}"><thead><tr>${v.head.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${v.venues.map(r => `<tr>${r.map((c, i) => `<td${i === 5 ? ' class="small mut"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
const summaryHtml = (v, id) => `<table class="s" id="${id}">${v.summary.map(([l, x]) => `<tr><td>${esc(l)}</td><td>${esc(x)}</td></tr>`).join("")}</table>`;
export function fundingSampleHtml(sample, price = 21) {
  const r = sample && sample.report; if (!r || !r.summary || !Array.isArray(r.venues) || !r.venues.length) return "";
  const v = fundingView(r), sm = r.summary, hi = (v.venues[0] || []), lo = (v.venues[v.venues.length - 1] || []);
  const cap = sm.spread_apr_pct != null && v.venues.length > 1 ? `Same coin, same hour: ${hi[0]} at ${hi[1]} per 8h, ${lo[0]} at ${lo[1]}. That gap is ${Number(sm.spread_apr_pct).toFixed(2)}% a year, before fees.` : "";
  return `<section id="s-example" class="card" aria-label="Example result">
<p class="small mut" style="margin:0"><b>Example, not a live check.</b> A real ${esc(v.coin)} snapshot, taken once on ${esc(utc(sample.checkedAt || r.as_of))} and saved here. Funding moves every hour and this one is never refreshed; yours runs fresh when you pay.</p>
<div class="scroll">${tableHtml(v, "xt")}</div>
${summaryHtml(v, "xs")}
${cap ? `<p class="small">${esc(cap)}</p>` : ""}
<p class="small mut">Full JSON for this example, free: <a href="/v1/funding/sample">/v1/funding/sample</a></p>
<p class="row" style="margin-top:10px"><button type="button" id="exgo">Get a live one for ${esc(String(price))} sats</button></p>
</section>`;
}
export function fundingPageHtml({ price = 21, sample = null, baseUrl = "" } = {}) {
  const ex = fundingSampleHtml(sample, price);
  const title = "Hexbox Tools: perp funding on ten exchanges, one page";
  const description = `Pick a coin, pay ${price} sats over Lightning, and see its perpetual funding rate on Binance, Bybit, OKX, Bitget, Gate, MEXC, KuCoin, Deribit, Kraken and Hyperliquid, on one 8h basis, with open interest and the spread.`;
  const b = /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(String(baseUrl || "")) ? String(baseUrl) : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Hexbox Tools"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">${b ? `<meta property="og:url" content="${esc(b + "/funding")}">` : ""}
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}">
<style>
:root{--fg:#1d1d1b;--mut:#6b6b66;--line:#d9d6cf;--bg:#f6f4ef;--acc:#2f5d50;--warn:#9a3b12}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:820px;margin:0 auto;padding:32px 18px 64px}h1{font-size:1.5rem;margin:0 0 4px}
.mut{color:var(--mut)}.small{font-size:.875rem}form{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0 6px;align-items:center}
select,input[type=text]{padding:10px 12px;border:1px solid var(--line);border-radius:6px;font:inherit;background:#fff}
button,.btn{padding:10px 16px;border:1px solid var(--acc);background:var(--acc);color:#fff;border-radius:6px;font:inherit;cursor:pointer;text-decoration:none;display:inline-block}
button.ghost,.btn.ghost{background:transparent;color:var(--acc)}button:disabled{opacity:.5;cursor:default}
.card{background:#fff;border:1px solid var(--line);border-radius:8px;padding:18px;margin-top:18px}
.qr{width:260px;max-width:100%;margin:0 auto 12px;display:block}.qr svg{width:100%;height:auto;display:block}
textarea{width:100%;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;border:1px solid var(--line);border-radius:6px;padding:8px;resize:none;height:84px;word-break:break-all}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.err{color:var(--warn)}.scroll{overflow-x:auto;margin-top:10px}
table{border-collapse:collapse;width:100%;font-size:.95rem}td,th{padding:6px 6px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}
table.v th{font-weight:600;font-size:.85rem;color:var(--mut)}table.v td:nth-child(2),table.v td:nth-child(3),table.v td:nth-child(5){font-variant-numeric:tabular-nums;white-space:nowrap}
table.s{margin-top:14px}table.s td:first-child{color:var(--mut);width:42%}code{font-size:.85rem}
pre{background:#f1efe9;border:1px solid var(--line);border-radius:6px;padding:10px;overflow:auto;font-size:12px;max-height:360px}
footer{margin-top:40px;font-size:.85rem;color:var(--mut)}[hidden]{display:none!important}
</style></head><body><main>
<h1>Hexbox Tools</h1>
<p>One exchange's funding rate tells you what its longs are paying. The useful number is how far apart ten exchanges are at the same moment, and getting it usually means ten tabs and a calculator, because half of them pay hourly.</p>
<p>Pick a coin. For ${price} sats you get its perpetual funding rate on Binance, Bybit, OKX, Bitget, Gate, MEXC, KuCoin, Deribit, Kraken and Hyperliquid, all put on an 8-hour basis, with APR, next funding time and open interest for each, plus the open-interest-weighted average, the highest and lowest venue and the spread between them. For BTC and ETH it also shows Deribit's implied vol (DVOL) next to 7- and 30-day realised vol.</p>
<p class="mut small">Positive means longs pay shorts. Hourly venues are scaled to 8h; Deribit is its trailing 8h. If fewer than two exchanges answer, nothing is used up: run it again on the same payment.${ex ? " A real example sits under the button, so you can see what you get first." : ""}</p>
<section id="s-form">
<form id="f"><label for="u" class="small mut">Coin</label><select id="u">${FUNDING_COINS.map(c => `<option value="${c}">${c}</option>`).join("")}</select><button id="go">Get the snapshot for ${price} sats</button></form>
<div id="ferr" class="err small" hidden></div>
${ex}
</section>
<section id="s-pay" class="card" hidden>
<div class="qr" id="qr"></div>
<p style="text-align:center;margin:0 0 8px"><b>${price} sats</b> <span class="mut small" id="exp"></span></p>
<textarea id="bolt" readonly aria-label="Lightning invoice"></textarea>
<div class="row"><button type="button" id="copy" class="ghost">Copy invoice</button><a id="openw" class="btn ghost" href="#">Open in wallet</a><button type="button" id="weblnbtn" class="ghost" hidden>Pay with browser wallet</button></div>
<p class="small mut" id="paystate">Waiting for payment. Any Lightning wallet works. This page updates by itself.</p>
<p class="small mut">Coin: <span id="purl"></span></p>
</section>
<section id="s-work" class="card" hidden><p><b>Paid.</b> Asking ten exchanges. Usually a couple of seconds.</p></section>
<section id="s-fail" class="card" hidden>
<p class="err"><b>Paid, but that one didn't go through.</b> <span id="ferrmsg"></span></p>
<p class="small">Your payment still counts. Exchanges sometimes stall for a minute; run it again, same coin or another, on this same payment.</p>
<form id="rf"><select id="ru">${FUNDING_COINS.map(c => `<option value="${c}">${c}</option>`).join("")}</select><button>Run it again</button></form>
</section>
<section id="s-exp" class="card" hidden><p>That invoice expired before it was paid, so nothing was charged.</p><button type="button" id="again1">Start over</button></section>
<section id="s-done" class="card" hidden>
<p class="small mut" id="rurl" style="margin:0"></p>
<div class="scroll"><table class="v" id="rt"></table></div>
<table class="s" id="rs"></table>
<div class="row"><a id="dl" class="btn ghost" download="funding.json" href="#">Download JSON</a><button type="button" id="again2">Another coin</button></div>
<details style="margin-top:12px"><summary class="small">Raw JSON</summary><pre id="raw"></pre></details>
</section>
<footer>Hexbox Tools. Rates come from each exchange's public API at the moment you pay: current or predicted rate as the venue publishes it, APR is simple (8h rate x 3 x 365). Not investment advice. Payment is a plain Lightning invoice; no account, no email. Scripts can get the same JSON over L402 at <code>/v1/funding?coin=</code> (<a href="/v1">API notes</a>).</footer>
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
  post({kind:"funding",q:q}).then(function(j){$("go").disabled=false;
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
    if(st==="failed"){$("ferrmsg").textContent=j.error||"";if(j.url)$("ru").value=j.url;show("s-fail");return;}
    if(st==="expired"){show("s-exp");location.hash="";return;}
    if(st==="done"){report(j.report,j.url);return;}
    timer=setTimeout(poll,5000);
  },function(){timer=setTimeout(poll,5000)});}
${fundingView.toString()}
function el(t,txt,cls){var e=document.createElement(t);if(txt!=null)e.textContent=txt;if(cls)e.className=cls;return e}
function report(r,q){r=r||{};show("s-done");var v=fundingView(r);
  $("rurl").textContent=(v.coin||q||"")+(v.asOf?" \\u00b7 taken "+v.asOf.slice(0,16).replace("T"," ")+" UTC":"");
  $("rt").textContent="";$("rs").textContent="";
  var hr=el("tr");v.head.forEach(function(h){hr.appendChild(el("th",h))});var th=el("thead");th.appendChild(hr);$("rt").appendChild(th);
  var tb=el("tbody");v.venues.forEach(function(x){var tr=el("tr");x.forEach(function(c,i){tr.appendChild(el("td",c,i===5?"small mut":null))});tb.appendChild(tr)});$("rt").appendChild(tb);
  v.summary.forEach(function(x){var tr=el("tr");tr.appendChild(el("td",x[0]));tr.appendChild(el("td",x[1]));$("rs").appendChild(tr)});
  var s=JSON.stringify(r,null,1);$("raw").textContent=s;$("dl").href=URL.createObjectURL(new Blob([s],{type:"application/json"}));}
function reset(){clearTimeout(timer);sid=null;location.hash="";show(null);$("u").focus();}
$("f").addEventListener("submit",function(e){e.preventDefault();start($("u").value)});
$("rf").addEventListener("submit",function(e){e.preventDefault();post({kind:"funding",q:$("ru").value,retry:sid}).then(function(j){if(j._code!==200){$("ferrmsg").textContent=j.error||"try again";return}show("s-work");poll()})});
$("copy").addEventListener("click",function(){var b=$("bolt");b.select();try{navigator.clipboard.writeText(bolt).then(function(){$("copy").textContent="Copied"},function(){document.execCommand("copy");$("copy").textContent="Copied"})}catch(e){document.execCommand("copy");$("copy").textContent="Copied"}});
$("weblnbtn").addEventListener("click",function(){var w=window.webln;if(!w)return;Promise.resolve(w.enable&&w.enable()).then(function(){return w.sendPayment(bolt)}).then(function(){$("paystate").textContent="Payment sent. Confirming\\u2026";poll()},function(e){$("paystate").textContent="Browser wallet said: "+((e&&e.message)||"cancelled")+". You can still scan or copy the invoice."})});
$("again1").addEventListener("click",reset);$("again2").addEventListener("click",reset);
var exgo=$("exgo");if(exgo)exgo.addEventListener("click",function(){$("u").focus();try{$("u").scrollIntoView({behavior:"smooth",block:"center"})}catch(e){}$("ferr").hidden=true;});
var qm=/[?&](?:coin|q)=([A-Za-z]{2,6})/.exec(location.search);if(qm){var cv=qm[1].toUpperCase();for(var i=0;i<$("u").options.length;i++)if($("u").options[i].value===cv)$("u").value=cv;}
var m=/s=([0-9a-f]{16,64})/.exec(location.hash);if(m){sid=m[1];$("s-form").hidden=true;poll();}
})();
</script></body></html>`;
}
