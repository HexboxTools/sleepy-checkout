// Oct 17 R52: browser checkout for the clinical trial pipeline check. Same /v1/web/* flow as /traction, kind:"trials".
// trialsView() runs in the page (inlined via toString) to lay out the paid result. Plain ES5, no regex/backticks inside it.
export function trialsView(r) {
  r = r || {};
  var c = r.counts || {}, n = function (v) { return v == null ? "\u2013" : Number(v).toLocaleString("en-US"); };
  var ph = c.byPhase || {}, st = c.byStatus || {};
  var nice = function (s) { return String(s || "").replace("PHASE", "Phase ").split("_").join(" ").toLowerCase().replace(/^./, function (x) { return x.toUpperCase(); }); };
  var join = function (o) { return Object.keys(o).sort().map(function (k) { return nice(k) + ": " + o[k]; }).join(", ") || "\u2013"; };
  var rows = [["Matched as", (r.ticker ? "ticker " + r.ticker + ": trials led by " + (r.sponsorSearched || "?") + " (collaborations left out)" : (r.matchedAs || "?")) + (r.truncated ? " (first " + n(r.analyzed) + " of " + n(r.totalInRegistry) + " analyzed)" : "")],
    ["Trials in the registry", n(r.totalInRegistry != null ? r.totalInRegistry : c.trials)], ["Still running", n(c.live)], ["With posted results", n(c.withResults)], ["Primary done, still in follow-up", n(c.primaryDoneStillActive)],
    ["By phase", join(ph)], ["By status", join(st)]];
  var sp = (r.topSponsors || []).slice(0, 5).map(function (s) { return s.name + " (" + s.trials + ")"; }).join(", ");
  if (sp) rows.push(["Top sponsors", sp]);
  var item = function (t, extra) { return { label: t.nct + ": " + t.title, sub: [nice(t.phase), nice(t.status), t.enrollment ? n(t.enrollment) + " people" : "", extra || ""].filter(Boolean).join(" \u00b7 "), url: t.url }; };
  var tot = function (title, total, arr) { arr = arr || []; return total != null && total > arr.length ? title + " (" + n(total) + " total, top " + arr.length + " shown)" : title; };
  var lists = [
    [tot("Primary completion due soon (a rough readout clock)", c.upcoming, r.upcomingPrimaryCompletion), (r.upcomingPrimaryCompletion || []).map(function (t) { return item(t, "primary completion " + t.primaryCompletion + (t.primaryCompletionType === "ESTIMATED" ? " (est.)" : "") + (t.daysAway != null ? (t.daysAway < 0 ? ", " + (-t.daysAway) + " days ago" : ", in " + t.daysAway + " days") : "")); })],
    [tot("Estimated primary completion passed, never updated", c.overdue, r.overduePrimaryCompletion), (r.overduePrimaryCompletion || []).map(function (t) { return item(t, "was due " + t.primaryCompletion); })],
    [tot("Live phase 3", c.liveLateStage, r.liveLateStage), (r.liveLateStage || []).map(function (t) { return item(t, "primary completion " + t.primaryCompletion); })],
    [tot("Updated in the registry lately", c.recentlyUpdated, r.recentlyUpdated), (r.recentlyUpdated || []).map(function (t) { return item(t, "updated " + t.lastUpdate); })]];
  return { input: r.query || "", rows: rows, lists: lists, checkedAt: r.checkedAt || "" };
}
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function trialsPageHtml({ price = 21, baseUrl = "" } = {}) {
  const title = "Hexbox Tools: what's actually in the trial pipeline";
  const description = `Type a ticker, sponsor, drug or condition, pay ${price} sats over Lightning, and get its ClinicalTrials.gov pipeline on one page: phases, what's due to read out, which estimated dates quietly slipped.`;
  const b = /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(String(baseUrl || "")) ? String(baseUrl) : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Hexbox Tools"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">${b ? `<meta property="og:url" content="${esc(b + "/trials")}">` : ""}
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}">
<style>
:root{--fg:#1d1d1b;--mut:#6b6b66;--line:#d9d6cf;--bg:#f6f4ef;--acc:#2f5d50;--warn:#9a3b12}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 18px 64px}h1{font-size:1.5rem;margin:0 0 4px}h3{font-size:1rem;margin:18px 0 4px}
.mut{color:var(--mut)}.small{font-size:.875rem}form{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0 6px}
input[type=text]{flex:1 1 360px;padding:10px 12px;border:1px solid var(--line);border-radius:6px;font:inherit;background:#fff}
button,.btn{padding:10px 16px;border:1px solid var(--acc);background:var(--acc);color:#fff;border-radius:6px;font:inherit;cursor:pointer;text-decoration:none;display:inline-block}
button.ghost,.btn.ghost{background:transparent;color:var(--acc)}button:disabled{opacity:.5;cursor:default}
.card{background:#fff;border:1px solid var(--line);border-radius:8px;padding:18px;margin-top:18px}
.qr{width:260px;max-width:100%;margin:0 auto 12px;display:block}.qr svg{width:100%;height:auto;display:block}
textarea{width:100%;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;border:1px solid var(--line);border-radius:6px;padding:8px;resize:none;height:84px;word-break:break-all}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.err{color:var(--warn)}
table{border-collapse:collapse;width:100%;font-size:.95rem}td{padding:6px 4px;border-bottom:1px solid var(--line);vertical-align:top}td:first-child{color:var(--mut);width:34%}
ul{padding-left:18px;margin:4px 0}li{margin:4px 0}code{font-size:.85rem}
pre{background:#f1efe9;border:1px solid var(--line);border-radius:6px;padding:10px;overflow:auto;font-size:12px;max-height:360px}
footer{margin-top:40px;font-size:.85rem;color:var(--mut)}[hidden]{display:none!important}
</style></head><body><main>
<h1>Hexbox Tools</h1>
<p>Company decks show the trials that are going well. The registry shows all of them, including the ones that passed their primary completion date months ago and still say "recruiting".</p>
<p>Type a ticker, a sponsor, a drug or a condition. For ${price} sats you get its ClinicalTrials.gov pipeline on one page: trials by phase and status, primary completion dates in the next six months (a rough clock for readouts), trials running past their own deadline, live phase 3, and what changed in the registry lately. Every trial links to its registry page.</p>
<p class="mut small">Plain text is read as a sponsor first, then a drug. Force it with <code>drug:tirzepatide</code> or <code>condition:obesity</code>. A ticker like <code>$VKTX</code> counts only trials that company leads itself (about 70 drug-company tickers so far). No match means no charge used: try another name on the same payment.</p>
<section id="s-form">
<form id="f"><input type="text" id="u" required maxlength="200" placeholder="$VKTX, Viking Therapeutics, drug:retatrutide, condition:ALS" autocomplete="off" spellcheck="false"><button id="go">Check for ${price} sats</button></form>
<div id="ferr" class="err small" hidden></div>
</section>
<section id="s-pay" class="card" hidden>
<div class="qr" id="qr"></div>
<p style="text-align:center;margin:0 0 8px"><b>${price} sats</b> <span class="mut small" id="exp"></span></p>
<textarea id="bolt" readonly aria-label="Lightning invoice"></textarea>
<div class="row"><button type="button" id="copy" class="ghost">Copy invoice</button><a id="openw" class="btn ghost" href="#">Open in wallet</a><button type="button" id="weblnbtn" class="ghost" hidden>Pay with browser wallet</button></div>
<p class="small mut" id="paystate">Waiting for payment. Any Lightning wallet works. This page updates by itself.</p>
<p class="small mut">Checking: <span id="purl"></span></p>
</section>
<section id="s-work" class="card" hidden><p><b>Paid.</b> Reading ClinicalTrials.gov. Big sponsors take up to half a minute.</p></section>
<section id="s-fail" class="card" hidden>
<p class="err"><b>Paid, but that one didn't go through.</b> <span id="ferrmsg"></span></p>
<p class="small">Your payment still counts. Try another spelling, a drug: or condition: search, and it runs on this same payment.</p>
<form id="rf"><input type="text" id="ru" required maxlength="200" placeholder="drug:semaglutide"><button>Check this</button></form>
</section>
<section id="s-exp" class="card" hidden><p>That invoice expired before it was paid, so nothing was charged.</p><button type="button" id="again1">Start over</button></section>
<section id="s-done" class="card" hidden>
<p class="small mut" id="rurl" style="margin:0"></p>
<table id="rt"></table>
<div id="lists"></div>
<div class="row"><a id="dl" class="btn ghost" download="trials.json" href="#">Download JSON</a><button type="button" id="again2">Check another</button></div>
<details style="margin-top:12px"><summary class="small">Raw JSON</summary><pre id="raw"></pre></details>
</section>
<footer>Hexbox Tools. Data from the public ClinicalTrials.gov registry, read fresh when you pay; dates are what sponsors entered, often estimates. Not investment or medical advice. Payment is a plain Lightning invoice; no account, no email. Scripts can run the same check over L402 at <code>/v1/trials?q=</code> (<a href="/v1">API notes</a>).</footer>
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
  post({kind:"trials",q:q}).then(function(j){$("go").disabled=false;
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
${trialsView.toString()}
function el(t,txt,cls){var e=document.createElement(t);if(txt!=null)e.textContent=txt;if(cls)e.className=cls;return e}
function report(r,q){r=r||{};show("s-done");var v=trialsView(r);$("rurl").textContent=(v.input||q||"")+(v.checkedAt?" \u00b7 checked "+v.checkedAt.slice(0,16).replace("T"," ")+" UTC":"");
  $("rt").textContent="";$("lists").textContent="";
  v.rows.forEach(function(x){var tr=el("tr");tr.appendChild(el("td",x[0]));tr.appendChild(el("td",x[1]));$("rt").appendChild(tr)});
  v.lists.forEach(function(L){$("lists").appendChild(el("h3",L[0]));if(!L[1].length){$("lists").appendChild(el("p","None.","small mut"));return}
    var ul=el("ul");L[1].forEach(function(it){var li=el("li");if(/^https:\\/\\//.test(String(it.url||""))){var a=el("a",it.label);a.href=it.url;a.rel="noopener noreferrer";a.target="_blank";li.appendChild(a)}else li.appendChild(el("span",it.label));
      li.appendChild(el("div",it.sub,"small mut"));ul.appendChild(li)});$("lists").appendChild(ul)});
  var s=JSON.stringify(r,null,1);$("raw").textContent=s;$("dl").href=URL.createObjectURL(new Blob([s],{type:"application/json"}));}
function reset(){clearTimeout(timer);sid=null;location.hash="";$("u").value="";show(null);$("u").focus();}
$("f").addEventListener("submit",function(e){e.preventDefault();start($("u").value.trim())});
$("rf").addEventListener("submit",function(e){e.preventDefault();post({kind:"trials",q:$("ru").value.trim(),retry:sid}).then(function(j){if(j._code!==200){$("ferrmsg").textContent=j.error||"try again";return}show("s-work");poll()})});
$("copy").addEventListener("click",function(){var b=$("bolt");b.select();try{navigator.clipboard.writeText(bolt).then(function(){$("copy").textContent="Copied"},function(){document.execCommand("copy");$("copy").textContent="Copied"})}catch(e){document.execCommand("copy");$("copy").textContent="Copied"}});
$("weblnbtn").addEventListener("click",function(){var w=window.webln;if(!w)return;Promise.resolve(w.enable&&w.enable()).then(function(){return w.sendPayment(bolt)}).then(function(){$("paystate").textContent="Payment sent. Confirming\u2026";poll()},function(e){$("paystate").textContent="Browser wallet said: "+((e&&e.message)||"cancelled")+". You can still scan or copy the invoice."})});
$("again1").addEventListener("click",reset);$("again2").addEventListener("click",reset);
var qm=/[?&]q=([^&]*)/.exec(location.search);if(qm){try{var qv=decodeURIComponent(String(qm[1]).replace(/\\+/g," ")).trim();if(qv&&qv.length<=200)$("u").value=qv}catch(e){}}
var m=/s=([0-9a-f]{16,64})/.exec(location.hash);if(m){sid=m[1];$("s-form").hidden=true;poll();}
})();
</script></body></html>`;
}
