// Oct 16: browser checkout page for the inspect service. Self-contained: no CDNs, QR comes from the server as SVG.
export function pageHtml({ price = 21 } = {}) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hexbox Tools: check a 3D file before you use it</title>
<meta name="description" content="Paste a link to a 3D file, pay ${price} sats over Lightning, and see what is really inside it.">
<style>
:root{--fg:#1d1d1b;--mut:#6b6b66;--line:#d9d6cf;--bg:#f6f4ef;--acc:#2f5d50;--warn:#9a3b12}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:720px;margin:0 auto;padding:32px 18px 64px}h1{font-size:1.5rem;margin:0 0 4px}h2{font-size:1.1rem;margin:24px 0 8px}
.mut{color:var(--mut)}.small{font-size:.875rem}form{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0 6px}
input[type=url]{flex:1 1 360px;padding:10px 12px;border:1px solid var(--line);border-radius:6px;font:inherit;background:#fff}
button,.btn{padding:10px 16px;border:1px solid var(--acc);background:var(--acc);color:#fff;border-radius:6px;font:inherit;cursor:pointer;text-decoration:none;display:inline-block}
button.ghost,.btn.ghost{background:transparent;color:var(--acc)}button:disabled{opacity:.5;cursor:default}
.card{background:#fff;border:1px solid var(--line);border-radius:8px;padding:18px;margin-top:18px}
.qr{width:260px;max-width:100%;margin:0 auto 12px;display:block}.qr svg{width:100%;height:auto;display:block}
textarea{width:100%;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;border:1px solid var(--line);border-radius:6px;padding:8px;resize:none;height:84px;word-break:break-all}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.err{color:var(--warn)}
table{border-collapse:collapse;width:100%;font-size:.95rem}td{padding:6px 4px;border-bottom:1px solid var(--line);vertical-align:top}td:first-child{color:var(--mut);width:44%}
ul.warn{margin:6px 0;padding-left:20px;color:var(--warn)}pre{background:#f1efe9;border:1px solid var(--line);border-radius:6px;padding:10px;overflow:auto;font-size:12px;max-height:360px}
footer{margin-top:40px;font-size:.85rem;color:var(--mut)}[hidden]{display:none!important}
</style></head><body><main>
<h1>Hexbox Tools</h1>
<p>Check a 3D file before you drop it into a scene, a store listing, or a print job. If the mesh has holes or flipped faces, you also get a repaired STL back, same price. Paste a public link, pay ${price} sats, and get back what is actually in it: whether the mesh is watertight (holes, non-manifold edges, flipped or inside-out faces, loose bits), volume, real size, triangles, n-gons, materials, texture sizes, missing UVs, unapplied transforms, and plain warnings about scale and weight.</p>
<p class="mut small">Formats: .glb, .gltf (embedded), .fbx, .obj, .stl, .ply, .usd/.usdc, .blend, or a .zip with one of those inside. Up to 200 MB. The file is opened once, read, and deleted. If it needs fixing, a repaired STL is kept for 2 hours so you can download it, then deleted.</p>

<section id="s-form">
<form id="f"><input type="url" id="u" required placeholder="https://example.com/chair.glb" autocomplete="off" spellcheck="false"><button id="go">Get invoice</button></form>
<div class="small mut">The link has to be https and reachable without a login: a Printables model page (first STL is checked), GitHub raw, S3, Dropbox with dl=1, your own site.</div>
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

<section id="s-work" class="card" hidden><p><b>Paid.</b> Opening the file now. Small files take a few seconds, big ones up to three minutes. You can leave this tab open; refreshing is fine too.</p></section>

<section id="s-fail" class="card" hidden>
<p class="err"><b>Paid, but that file wouldn't open.</b> <span id="ferrmsg"></span></p>
<p class="small">Your payment still counts. Paste a different link and it will run on this same payment.</p>
<form id="rf"><input type="url" id="ru" required placeholder="https://example.com/other.glb"><button>Try this link</button></form>
</section>

<section id="s-exp" class="card" hidden><p>That invoice expired before it was paid, so nothing was charged.</p><button type="button" id="again1">Start over</button></section>

<section id="s-done" class="card" hidden>
<h2 style="margin-top:0">Report</h2>
<p class="small mut" id="rurl"></p>
<div id="repbox"></div>
<div id="warnbox"></div>
<table id="rt"></table>
<div class="row"><a id="dl" class="btn ghost" download="inspect-report.json" href="#">Download JSON</a><button type="button" id="again2">Check another file</button></div>
<details style="margin-top:12px"><summary class="small">Raw JSON</summary><pre id="raw"></pre></details>
</section>

<footer>Hexbox Tools. Payment is a plain Lightning invoice; no account, no email. Scripts can use the same check over L402 at <code>/v1/inspect</code> (<a href="/v1">API notes</a>).</footer>
</main>
<script>
(function(){
var $=function(i){return document.getElementById(i)};var sid=null,timer=null,bolt="";
var S=["s-pay","s-work","s-fail","s-exp","s-done"];
function show(id){S.forEach(function(x){$(x).hidden=(x!==id)});$("s-form").hidden=!!id;}
function ferr(m){var e=$("ferr");e.textContent=m||"";e.hidden=!m;}
function api(p,o){return fetch(p,o).then(function(r){return r.json().then(function(j){j._code=r.status;return j},function(){return{_code:r.status,error:"unexpected reply ("+r.status+")"}})})}
function start(url,retry){ferr("");$("go").disabled=true;
  api("/v1/web/start",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(retry?{url:url,retry:retry}:{url:url})}).then(function(j){
    $("go").disabled=false;
    if(j._code!==200){ if(retry){$("ferrmsg").textContent=j.error||"try again";} else ferr(j.error||"couldn't make an invoice, try again in a minute"); return;}
    sid=j.id;location.hash="s="+sid;
    if(j.bolt11)payView(j,url);else poll();
  },function(){$("go").disabled=false;ferr("network problem, try again")});}
function payView(j,url){bolt=j.bolt11;$("qr").innerHTML=j.qr_svg||"";$("bolt").value=bolt;$("openw").href="lightning:"+bolt;$("purl").textContent=url||j.url||"";
  if(j.expires){var t=new Date(j.expires);$("exp").textContent="(invoice good until "+t.toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})+")";}
  $("weblnbtn").hidden=!window.webln;show("s-pay");poll();}
function poll(){clearTimeout(timer);if(!sid)return;
  api("/v1/web/status?id="+encodeURIComponent(sid)).then(function(j){
    if(j._code===404){location.hash="";sid=null;show(null);ferr("That checkout is gone (they last 30 minutes unpaid). Start a new one.");return;}
    var st=j.state;
    if(st==="unpaid"){ if($("s-pay").hidden&&j.bolt11)return payView(j); timer=setTimeout(poll,3000);return;}
    if(st==="paid"||st==="working"){show("s-work");timer=setTimeout(poll,3000);return;}
    if(st==="failed"){$("ferrmsg").textContent=j.error||"";show("s-fail");return;}
    if(st==="expired"){show("s-exp");location.hash="";return;}
    if(st==="done"){report(j.report);return;}
    timer=setTimeout(poll,5000);
  },function(){timer=setTimeout(poll,5000)});}
function fmt(v){if(v==null)return"";if(Array.isArray(v)){if(!v.length)return"none";return v.map(function(x){return typeof x==="object"?(x.name?x.name+(x.w?" "+x.w+"x"+x.h:""):JSON.stringify(x)):String(x)}).join(", ")}if(typeof v==="object")return JSON.stringify(v);return String(v)}
var LBL=[["triangles","Triangles"],["vertices","Vertices"],["ngons","N-gons (5+ sides)"],["meshes","Meshes"],["materials","Materials"],["textures","Textures"],["largest_textures","Largest textures"],["size","Size (x, y, z)"],["units","Units"],["bounds_min","Bounds min"],["bounds_max","Bounds max"],["meshes_without_uv","Meshes without UVs"],["meshes_without_material","Meshes without a material"],["unapplied_transforms","Unapplied transforms"],["animations","Animations"],["armatures","Armatures"]];
function report(r){r=r||{};show("s-done");$("s-form").hidden=true;$("rurl").textContent=r.url||"";
  var wb=$("warnbox");wb.textContent="";if(r.warnings&&r.warnings.length){var ul=document.createElement("ul");ul.className="warn";r.warnings.forEach(function(w){var li=document.createElement("li");li.textContent=w;ul.appendChild(li)});wb.appendChild(ul)}else{var p=document.createElement("p");p.className="small mut";p.textContent="No warnings.";wb.appendChild(p)}
  var rb=$("repbox");rb.textContent="";var R=r.repair;
  if(R&&R.ok&&R.download){var d=document.createElement("div");d.className="card";d.style.marginTop="0";d.style.marginBottom="12px";
    var h=document.createElement("p");h.style.margin="0 0 6px";var bb=document.createElement("b");bb.textContent=R.watertight_after?"Repaired: the fixed copy is watertight.":"Partly repaired: some problems need a manual fix.";h.appendChild(bb);d.appendChild(h);
    var ul2=document.createElement("ul");ul2.className="small";(R.fixed||[]).concat(R.still_needs_work||[]).forEach(function(x){var li=document.createElement("li");li.textContent=x;ul2.appendChild(li)});d.appendChild(ul2);
    var a2=document.createElement("a");a2.className="btn";a2.href=R.download;a2.textContent="Download repaired STL";d.appendChild(a2);
    var n2=document.createElement("p");n2.className="small mut";n2.textContent=(R.volume_cm3_if_mm!=null?"Volume after repair: "+R.volume_cm3_if_mm+" cm³ if units are mm. ":"")+"Holes are capped flat, so check curved areas in your slicer. "+(R.units||"")+". Link works for 2 hours.";d.appendChild(n2);rb.appendChild(d);}
  else if(R&&!R.ok){var p3=document.createElement("p");p3.className="small err";p3.textContent="Automatic repair didn't work on this file: "+(R.error||"unknown error");rb.appendChild(p3);}
  var t=$("rt");t.textContent="";var seen={url:1,warnings:1,repair:1};
  function add(k,l){if(!(k in r))return;seen[k]=1;var tr=document.createElement("tr"),a=document.createElement("td"),b=document.createElement("td");a.textContent=l;b.textContent=fmt(r[k]);tr.appendChild(a);tr.appendChild(b);t.appendChild(tr)}
  var P=r.print;if(P&&typeof P==="object"){seen.print=1;var pr=function(l,v){var tr=document.createElement("tr"),a=document.createElement("td"),b=document.createElement("td");a.textContent=l;b.textContent=fmt(v);tr.appendChild(a);tr.appendChild(b);t.appendChild(tr)};
    if(P.skipped)pr("Printability",P.skipped);else{pr("Printability",P.verdict);pr("Watertight",P.watertight?"yes":"no");pr("Open edges (holes)",P.open_edges);pr("Non-manifold edges",P.non_manifold_edges);pr("Flipped-face edges",P.inconsistent_normals_edges);pr("Inside-out normals",P.normals_inside_out?"yes":"no");pr("Separate shells",P.shells);pr("Loose verts / edges",P.loose_vertices+" / "+P.loose_edges);pr("Zero-area faces",P.zero_area_faces);if(P.volume_cm3_if_mm!=null)pr("Volume (cm³, if units are mm)",P.volume_cm3_if_mm)}}
  LBL.forEach(function(x){add(x[0],x[1])});Object.keys(r).forEach(function(k){if(!seen[k])add(k,k.replace(/_/g," "))});
  var s=JSON.stringify(r,null,1);$("raw").textContent=s;$("dl").href=URL.createObjectURL(new Blob([s],{type:"application/json"}));}
function reset(){clearTimeout(timer);sid=null;location.hash="";$("u").value="";show(null);$("u").focus();}
$("f").addEventListener("submit",function(e){e.preventDefault();start($("u").value.trim())});
$("rf").addEventListener("submit",function(e){e.preventDefault();var u=$("ru").value.trim();api("/v1/web/start",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url:u,retry:sid})}).then(function(j){if(j._code!==200){$("ferrmsg").textContent=j.error||"try again";return}show("s-work");poll()})});
$("copy").addEventListener("click",function(){var b=$("bolt");b.select();try{navigator.clipboard.writeText(bolt).then(function(){$("copy").textContent="Copied"},function(){document.execCommand("copy");$("copy").textContent="Copied"})}catch(e){document.execCommand("copy");$("copy").textContent="Copied"}});
$("weblnbtn").addEventListener("click",function(){var w=window.webln;if(!w)return;Promise.resolve(w.enable&&w.enable()).then(function(){return w.sendPayment(bolt)}).then(function(){$("paystate").textContent="Payment sent. Confirming…";poll()},function(e){$("paystate").textContent="Browser wallet said: "+((e&&e.message)||"cancelled")+". You can still scan or copy the invoice."})});
$("again1").addEventListener("click",reset);$("again2").addEventListener("click",reset);
var m=/s=([0-9a-f]{16,64})/.exec(location.hash);if(m){sid=m[1];$("s-form").hidden=true;poll();}
})();
</script></body></html>`;
}
