// Hexbox 3D model inspect over L402. 127.0.0.1:8796, exposed by run-tunnel.sh (liveapps, no account).
import http from "http"; import fs from "fs"; import path from "path"; import os from "os"; import dns from "dns/promises"; import crypto from "crypto";
import { loadRootKey, invoiceInfo, makeMacaroon, challengeHeaders, verifyAuth } from "./l402.mjs";
import { traction as realTraction } from "./plugins/traction/traction.mjs";
import { trials as realTrials } from "./plugins/trials/trials.mjs";
import { funding as realFunding } from "./plugins/funding/funding.mjs";
import { renderSVG } from "uqr"; import { pageHtml } from "./web-page.mjs"; import { tractionPageHtml } from "./traction-page.mjs"; import { trialsPageHtml } from "./trials-page.mjs"; import { fundingPageHtml, FUNDING_COINS } from "./funding-page.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SERVICE = "model-inspect", PRICE = 21, TTL = 3600;
const log = (...a) => { const f = process.env.L402_LOG || path.join(HERE, "l402.log"); fs.appendFileSync(f, new Date().toISOString() + " " + a.join(" ") + "\n"); }; // tests: L402_LOG=/tmp/… before import
const privateIp = a => /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(a) || /^(::1|::$|f[cd]|fe80|::ffff:)/i.test(a);

export async function checkUrl(u, { lookup = h => dns.lookup(h, { all: true }), allowLocal = false } = {}) {
  let x; try { x = new URL(u); } catch { return "url is not a valid URL"; }
  if (x.protocol !== "https:" && !(allowLocal && x.protocol === "http:")) return "url must be https";
  if (allowLocal) return null;
  if (x.port && x.port !== "443") return "url must use port 443";
  try { const a = await lookup(x.hostname); if (!a.length || a.some(r => privateIp(r.address))) return "url host is not public"; } catch { return "url host does not resolve"; }
  return null;
}

let heavy = Promise.resolve(), queued = 0;
const serial = fn => { queued++; const p = heavy.then(fn, fn).finally(() => queued--); heavy = p.catch(() => {}); return p; };

const MAX_UPLOAD = 200 * 1024 * 1024;
const EXT_OK = new Set(["glb", "gltf", "fbx", "obj", "stl", "ply", "usd", "usdc", "blend", "zip"]);

function sniffExt(buf, name = "") {
  const n = (name.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  if (n && EXT_OK.has(n)) return n === "usdz" ? null : n;
  const head = buf.slice(0, 64);
  const s = head.toString("latin1");
  if (s.startsWith("glTF") || (head[0] === 0x67 && head[1] === 0x6c)) return "glb";
  if (s.startsWith("Kaydara FBX")) return "fbx";
  if (s.startsWith("ply") || s.startsWith("PLY")) return "ply";
  if (s.startsWith("PXR-USDC")) return "usdc";
  if (s.startsWith("BLENDER") || (head[0] === 0x1f && head[1] === 0x8b) || head.slice(0, 4).toString("hex") === "28b52ffd") return "blend";
  if (s.startsWith("PK")) return "zip";
  if (/^solid /i.test(s) || head.slice(0, 5).toString() === "solid") return "stl";
  if (n) return n;
  return null;
}

/** Local bytes → same Blender path as URL inspect. name is only for extension/sniff. */
export async function realInspectBytes(buf, name = "upload.bin") {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length > MAX_UPLOAD) throw new Error("file is over 200 MB");
  if (!buf.length) throw new Error("empty file");
  const { sh, BLENDER } = await import("./plugins/shop/services.mjs");
  const dir = path.join(os.tmpdir(), "hexl402", crypto.randomBytes(4).toString("hex"));
  try {
    fs.mkdirSync(dir, { recursive: true });
    let ext = sniffExt(buf, name);
    if (!ext) throw new Error("can't tell what that file is. .blend, .fbx, .glb, .gltf, .obj, .stl, .ply, .usd, or a zip");
    if (ext === "zip") {
      const z = path.join(dir, "in.zip"); fs.writeFileSync(z, buf);
      const py = `import zipfile,os,sys
z=zipfile.ZipFile(sys.argv[1]);d=os.path.realpath(sys.argv[2]);tot=0
for m in z.infolist():
  p=os.path.realpath(os.path.join(d,m.filename));tot+=m.file_size
  assert p.startswith(d+os.sep), "bad path in zip"
  assert tot<1500*1024*1024, "zip too big unpacked"
z.extractall(d)
E=tuple(sys.argv[3].split(','))
b=sorted([os.path.join(r,f) for r,_,fs in os.walk(d) for f in fs if f.lower().endswith(E)],key=lambda p:(not p.endswith('.blend'),p.count(os.sep),p))
print(b[0] if b else '')`;
      const r2 = await sh("python3", ["-c", py, z, path.join(dir, "x"), ".blend,.fbx,.glb,.gltf,.obj,.stl,.ply,.usd,.usdc"]);
      const f = r2.out.trim();
      if (r2.code || !f) throw new Error(r2.code ? "couldn't unpack that zip" : "no model file inside the zip");
      const args = ["-b", "--disable-autoexec", ...(f.endsWith(".blend") ? [f] : ["--factory-startup"]), "--python", path.join(HERE, "inspect_job.py"), "--", f];
      const r = await sh(BLENDER, args, { timeoutMs: 180000 });
      const m = r.out.match(/^JOBINFO (.*)$/m); if (m) return JSON.parse(m[1]);
      throw new Error((r.out.match(/^JOBERR (.*)$/m) || [])[1] || "Blender couldn't open that file");
    }
    const file = path.join(dir, "in." + ext); fs.writeFileSync(file, buf);
    const args = ["-b", "--disable-autoexec", ...(ext === "blend" ? [file] : ["--factory-startup"]), "--python", path.join(HERE, "inspect_job.py"), "--", file];
    const r = await sh(BLENDER, args, { timeoutMs: 180000 });
    const m = r.out.match(/^JOBINFO (.*)$/m); if (m) return JSON.parse(m[1]);
    throw new Error((r.out.match(/^JOBERR (.*)$/m) || [])[1] || "Blender couldn't open that file");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** printables.com/model/<id>-slug page link -> direct file link (anonymous public API). Non-Printables URLs pass through. */
export async function resolvePrintables(u, { fetchFn = fetch } = {}) {
  let x; try { x = new URL(u); } catch { return { url: u }; }
  if (!/(^|\.)printables\.com$/i.test(x.hostname) || x.hostname.startsWith("files.")) return { url: u };
  const m = /\/model\/(\d+)/.exec(x.pathname); if (!m) return { url: u };
  const id = m[1], api = "https://api.printables.com/graphql/";
  const gq = async query => { const r = await fetchFn(api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error("Printables lookup failed (" + r.status + ")"); return (await r.json()).data || {}; };
  const d = await gq(`query { print(id: "${id}") { id name stls { id name fileSize } } }`);
  const files = (d.print && d.print.stls) || [];
  if (!files.length) throw new Error("that Printables model has no files Blender can read here (3MF/STEP-only models aren't supported); paste a direct .stl/.obj link instead");
  const ok = files.filter(f => /\.(stl|obj|ply|glb|gltf|fbx)$/i.test(f.name));
  if (!ok.length) throw new Error("that Printables model only has 3MF/STEP files; paste a direct .stl/.obj link instead");
  const pick = ok[0];
  const l = await gq(`mutation { getDownloadLink(id: "${pick.id}", printId: "${id}", fileType: stl, source: model_detail) { ok output { link } } }`);
  const link = l.getDownloadLink && l.getDownloadLink.ok && l.getDownloadLink.output && l.getDownloadLink.output.link;
  if (!link) throw new Error("Printables didn't hand out a download link for that model");
  return { url: link, source: { printables_model: id, file: pick.name, other_files: ok.slice(1).map(f => f.name).slice(0, 20) } };
}

/** URL string, or { bytes, name } from an authenticated upload. */
/** Oct 16 2:30 PM: auto print-repair (weld, drop loose, fill holes, fix normals) -> binary STL at out. Never throws. */
export async function runRepair(file, out, { sh, BLENDER }) {
  try {
    const args = ["-b", "--disable-autoexec", ...(file.endsWith(".blend") ? [file] : ["--factory-startup"]), "--python", path.join(HERE, "repair_job.py"), "--", file, out];
    const r = await sh(BLENDER, args, { timeoutMs: 180000 });
    const m = r.out.match(/^REPAIRINFO (.*)$/m); if (m && fs.existsSync(out)) return JSON.parse(m[1]);
    return { ok: false, error: (r.out.match(/^JOBERR (.*)$/m) || [])[1] || "repair didn't finish" };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200) }; }
}
const needsRepair = o => !!(o && o.print && !o.print.skipped && (o.print.problems || []).length);

export async function realInspect(target, opts = {}) {
  if (target && typeof target === "object" && target.bytes) return realInspectBytes(target.bytes, target.name || "upload.bin");
  const url = target;
  const { fetchBlend, sh, BLENDER } = await import("./plugins/shop/services.mjs");
  const dir = path.join(os.tmpdir(), "hexl402", crypto.randomBytes(4).toString("hex"));
  try {
    const safeFetch = async (u0, opt) => { let u1 = u0; for (let i = 0; i < 5; i++) { const bad = await checkUrl(u1); if (bad) throw new Error("redirect target rejected: " + bad); const r = await fetch(u1, { ...opt, redirect: "manual" }); if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { u1 = new URL(r.headers.get("location"), u1).href; continue; } return r; } throw new Error("too many redirects"); };
    const rp = await resolvePrintables(url);
    const file = await fetchBlend(rp.url, dir, safeFetch, true);
    const args = ["-b", "--disable-autoexec", ...(file.endsWith(".blend") ? [file] : ["--factory-startup"]), "--python", path.join(HERE, "inspect_job.py"), "--", file];
    const r = await sh(BLENDER, args, { timeoutMs: 180000 });
    const m = r.out.match(/^JOBINFO (.*)$/m); if (m) { const o = JSON.parse(m[1]); if (rp.source) o.source = rp.source;
      if (opts.repairOut && needsRepair(o)) o.repair = await runRepair(file, opts.repairOut, { sh, BLENDER });
      return o; }
    throw new Error((r.out.match(/^JOBERR (.*)$/m) || [])[1] || "Blender couldn't open that file");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** Pull one file out of a simple multipart/form-data body (file|model|upload field, or first filename= part). */
export function parseMultipartFile(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || "");
  if (!m) throw new Error("multipart boundary missing");
  const boundary = m[1] || m[2];
  const sep = Buffer.from("--" + boundary);
  let start = buf.indexOf(sep);
  if (start < 0) throw new Error("multipart body has no boundary");
  start += sep.length;
  if (buf[start] === 13 && buf[start + 1] === 10) start += 2;
  while (start < buf.length) {
    if (buf[start] === 45 && buf[start + 1] === 45) break; // closing --
    const next = buf.indexOf(Buffer.from("\r\n--" + boundary), start);
    const part = next < 0 ? buf.slice(start) : buf.slice(start, next);
    const split = part.indexOf("\r\n\r\n");
    if (split < 0) break;
    const head = part.slice(0, split).toString("binary");
    const body = part.slice(split + 4);
    const cd = /content-disposition:\s*form-data;([^\r\n]+)/i.exec(head);
    const name = cd && /name="([^"]+)"/i.exec(cd[1]);
    const fname = cd && /filename="([^"]*)"/i.exec(cd[1]);
    const field = name ? name[1] : "";
    if (fname && (fname[1] || ["file", "model", "upload", "asset"].includes(field))) {
      return { bytes: Buffer.from(body), name: fname[1] || (field + ".bin") };
    }
    if (next < 0) break;
    start = next + 2 + sep.length; // skip CRLF + --boundary
    if (buf[start] === 13 && buf[start + 1] === 10) start += 2;
  }
  throw new Error("multipart had no file part (use field file/model/upload with a filename)");
}

async function readBody(req, max) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > max) { req.resume?.(); throw Object.assign(new Error("body too big"), { code: 413 }); }
    chunks.push(c);
  }
  return Buffer.concat(chunks, n);
}

// Oct 14 22:30 ET: Spark auth DEADLINE_EXCEEDED made createLightningInvoice throw (500) or hang until a manual kill.
// Invoice calls are now bounded (invoiceTimeoutMs -> 503), consecutive failures are counted, and onWedged fires after
// maxInvoiceFails in a row or when failures have lasted staleMs with no success. In main, onWedged exits so run-l402.sh restarts.
export function withTimeout(p, ms, what = "call") { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms); })]).finally(() => clearTimeout(t)); }
export function createApp({ wallet, rootKey, inspect = realInspect, tractionFn = realTraction, trialsFn = realTrials, fundingFn = realFunding, usedFile = path.join(HERE, "used.json"), allowLocal = false, maxChallengesPerMin = 30, decodeInvoice = invoiceInfo,
  invoiceTimeoutMs = 25000, maxInvoiceFails = 3, staleMs = 8 * 60000, onWedged = () => {},
  // Oct 16 5:17 AM: Spark timeouts still 503'd payers after serialize. Coalesce concurrent mints into one
  // Spark call, reuse a fresh unpaid challenge briefly, and on mint fail serve the last good challenge
  // (invoice still payable) instead of 503 — mystery shoppers / agents keep a path to pay.
  // Oct 16 10:20 AM: reuse 2 min (was 45s — reminting under probe load helped wedge Spark);
  // fallback 14 min (was 10 min — a 10m49s idle gap past fallback left inspect hanging 25s×3 at 14:22Z).
  // Invoice expiry is 900s; keep fallback under that. seedChallenge + keep-warm fill lastChallenge after start.
  challengeReuseMs = 120000, challengeFallbackMs = 840000,
  // Oct 16 7:21 AM: browser checkout (/try, /v1/web/*). Each web session mints its OWN invoice (never the shared
  // 45 s L402 challenge, never the single-flight result), so one person's payment can't unlock another's session.
  // Paid status comes from Spark getLightningReceiveRequest(id).status. Sessions persist to webSessionsFile so a
  // wake-restart doesn't lose a paid report. Unpaid kept 30 min (invoice 15 min + freeze slack), paid 2 h.
  receiveStatus = async (w, id) => String((await w.getLightningReceiveRequest(id))?.status || ""),
  webSessionsFile = null, webPerIp = 10, webGlobal = 60, webWinMs = 600000, webMax = 300,
  repairDir = path.join(os.tmpdir(), "hexl402-repaired"), tractionSampleFile = path.join(HERE, "traction-sample.json"), fundingSampleFile = path.join(HERE, "funding-sample.json"), tractionCardFile = path.join(HERE, "traction-card.png"), publicBaseFile = path.join(HERE, "base.url"), webUnpaidTtlMs = 30 * 60000, webPaidTtlMs = 2 * 3600000, statusMinIntervalMs = 2500, statusTimeoutMs = 15000 }) {
  let invFails = 0, firstFailAt = 0, wedged = false;
  // Oct 17 4:30 AM: free saved example for /traction + GET /v1/traction/sample. Read ONCE here (a real traction() run,
  // see traction-sample.json checkedAt). Never calls tractionFn, never mints: it's a file, not a check.
  let tractionSample = null;
  try { if (tractionSampleFile && fs.existsSync(tractionSampleFile)) { const o = JSON.parse(fs.readFileSync(tractionSampleFile, "utf8")); if (o && o.report && o.report.scoredOn) tractionSample = { ...o, example: true }; } }
  catch (e) { log("traction-sample-load-fail", e.message); }
  // Oct 18 R66: free saved example for /funding + GET /v1/funding/sample. A real funding("BTC") run (funding-sample.json
  // checkedAt), read ONCE here. Never calls fundingFn, never mints. It's a file, not a live check.
  let fundingSample = null;
  try { if (fundingSampleFile && fs.existsSync(fundingSampleFile)) { const o = JSON.parse(fs.readFileSync(fundingSampleFile, "utf8")); if (o && o.report && o.report.summary && Array.isArray(o.report.venues) && o.report.venues.length) fundingSample = { ...o, example: true, live: false }; } }
  catch (e) { log("funding-sample-load-fail", e.message); }
  // Oct 17 R44: link-preview card for /traction (og:image). Static PNG built once by make-card.mjs from traction-sample.json.
  // Read ONCE here; free route, never mints, never calls tractionFn. Missing file -> no og:image, route 404.
  let tractionCard = null;
  try { if (tractionCardFile && fs.existsSync(tractionCardFile)) { const b = fs.readFileSync(tractionCardFile); if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) tractionCard = b; else log("traction-card-not-png"); } }
  catch (e) { log("traction-card-load-fail", e.message); }
  // og:url / og:image need the public https origin: base.url (re-read per request, tiny file), else the request host.
  const publicBase = req => { try { const v = fs.readFileSync(publicBaseFile, "utf8").trim().replace(/\/+$/, ""); if (/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(v)) return v; } catch {} return base(req); };
  const invoiceFailed = msg => { invFails++; if (!firstFailAt) firstFailAt = Date.now();
    log("invoice-fail", `#${invFails}`, String(msg).replace(/\s+/g, " ").slice(0, 240));
    const why = invFails >= maxInvoiceFails ? `${invFails} invoice failures in a row` : Date.now() - firstFailAt >= staleMs ? `no good invoice for ${Math.round((Date.now() - firstFailAt) / 1000)} s` : null;
    if (why && !wedged) { wedged = true; log("invoice-wedge:", why + ", exiting for restart"); onWedged(why); } };
  // Single-flight + serial: concurrent waiters share one mint; withTimeout does not cancel the SDK call.
  let invTail = Promise.resolve(), invInflight = null;
  const doMint = async (w, memo = "Hexbox 3D model inspect") => {
    const inv = await withTimeout(w.createLightningInvoice({ amountSats: PRICE, memo, expirySeconds: 900 }), invoiceTimeoutMs, "createLightningInvoice");
    const pr = inv?.invoice?.encodedInvoice; if (!pr) throw new Error("wallet returned no invoice");
    const { paymentHash } = decodeInvoice(pr);
    return { inv, pr, paymentHash };
  };
  // Web checkout: serialized with the L402 mints (one Spark call at a time) but never shared.
  const mintFresh = (w, memo) => { const run = () => doMint(w, memo); const p = invTail.then(run, run); invTail = p.catch(() => {}); return p; };
  const mintInvoice = (w) => {
    if (invInflight) return invInflight;
    const run = () => doMint(w);
    const p = invTail.then(run, run);
    invTail = p.catch(() => {});
    invInflight = p.then(
      v => { invInflight = null; return v; },
      e => { invInflight = null; throw e; }
    );
    return invInflight;
  };
  let lastChallenge = null; // { mac, pr, paymentHash, invId, at }
  const used = new Set(fs.existsSync(usedFile) ? JSON.parse(fs.readFileSync(usedFile, "utf8")) : []);
  const markUsed = h => { used.add(h); if (lastChallenge && lastChallenge.paymentHash === h) lastChallenge = null; fs.writeFileSync(usedFile, JSON.stringify([...used])); };
  let win = 0, winStart = Date.now();
  // ---- browser checkout sessions ----
  const PAID_RE = /^(TRANSFER_COMPLETED|LIGHTNING_PAYMENT_RECEIVED|PAYMENT_PREIMAGE_RECOVERED|TRANSFER_CREATED)$/;
  const web = new Map(); // id -> { id, url, invId, pr, paymentHash, created, expires, state, paidAt, report, error, lastCheck }
  if (webSessionsFile && fs.existsSync(webSessionsFile)) {
    try { for (const s of JSON.parse(fs.readFileSync(webSessionsFile, "utf8"))) { if (s.state === "working") s.state = "paid"; web.set(s.id, s); } }
    catch (e) { log("web-load-fail", e.message); }
  }
  const saveWeb = () => { if (!webSessionsFile) return;
    try { const t = webSessionsFile + ".tmp"; fs.writeFileSync(t, JSON.stringify([...web.values()].map(({ job, checking, ...s }) => s))); fs.renameSync(t, webSessionsFile); }
    catch (e) { log("web-save-fail", e.message); } };
  fs.mkdirSync(repairDir, { recursive: true });
  const sweepWeb = () => { const now = Date.now(); let n = 0;
    for (const s of web.values()) { const end = s.paidAt ? s.paidAt + webPaidTtlMs : s.created + webUnpaidTtlMs; if (now > end && !s.job) { if (s.repairFile) try { fs.rmSync(s.repairFile, { force: true }); } catch {} web.delete(s.id); n++; } }
    if (n) saveWeb(); };
  const hits = new Map(); let globalHits = [];
  const clientIp = req => { const xff = String(req.headers["x-forwarded-for"] || "").split(",").map(x => x.trim()).filter(Boolean);
    return String(req.headers["cf-connecting-ip"] || xff.at(-1) || req.headers["x-real-ip"] || req.socket?.remoteAddress || "?").slice(0, 64); };
  const ipSrc = req => req.headers["cf-connecting-ip"] ? "cf" : req.headers["x-forwarded-for"] ? "xff" : req.headers["x-real-ip"] ? "real" : "sock";
  const ipTag = req => ipSrc(req) + ":" + crypto.createHash("sha256").update(clientIp(req)).digest("hex").slice(0, 6); // no raw IPs in logs
  const rateOk = ip => { const now = Date.now(), cut = now - webWinMs;
    globalHits = globalHits.filter(t => t > cut);
    const mine = (hits.get(ip) || []).filter(t => t > cut);
    if (mine.length >= webPerIp || globalHits.length >= webGlobal) { hits.set(ip, mine); return false; }
    mine.push(now); globalHits.push(now); hits.set(ip, mine);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => t > cut)) hits.delete(k);
    return true; };
  const startJob = s => {
    if (s.job || s.state === "done") return;
    s.state = "working"; s.error = null;
    if (s.kind === "trials") { // Oct 17 R52: browser checkout for the trial pipeline check
      s.job = Promise.resolve().then(() => { if (String(s.url).replace(/^(sponsor|drug|condition)\s*:\s*/i, "").trim().length < 2) throw new Error("that's too short to search; type a sponsor, drug or condition"); return trialsFn(s.url); }).then(
        r => { if (!r || !r.analyzed) throw new Error("no trials found for that on ClinicalTrials.gov. Try the sponsor's registered name, or drug: / condition:"); return r; }).then(
        r => { s.report = r; s.state = "done"; log("DELIVERED web-trials", s.paymentHash, String(s.url).slice(0, 120)); },
        e => { s.state = "failed"; s.error = String(e.message || e).slice(0, 300); log("trials-fail web", s.paymentHash, s.error); }
      ).finally(() => { s.job = null; saveWeb(); });
      return;
    }
    if (s.kind === "funding") { // Oct 18 R66: browser checkout for the funding snapshot. <2 venues -> failed, retry on the same payment
      s.job = Promise.resolve().then(() => fundingFn(s.url)).then(
        r => { if (!r || !Array.isArray(r.venues) || r.venues.length < 2) throw new Error("fewer than 2 venues answered"); s.report = r; s.state = "done"; log("DELIVERED web-funding", s.paymentHash, String(s.url).slice(0, 20)); },
        e => { throw e; }).catch(e => { const m = String(e.message || e); s.state = "failed";
          s.error = (/fewer than 2/.test(m) ? "fewer than two exchanges answered just now, so there's nothing to compare. Your payment is still good: run it again in a minute." : m).slice(0, 300); log("funding-fail web", s.paymentHash, m.slice(0, 200)); }
      ).finally(() => { s.job = null; saveWeb(); });
      return;
    }
    if (s.kind === "traction") { // Oct 17: browser checkout for the launch traction check (no Blender, no serial queue)
      s.job = Promise.resolve().then(() => tractionFn(s.url)).then(
        r => { s.report = r; s.state = "done"; log("DELIVERED web-traction", s.paymentHash, String(s.url).slice(0, 120)); },
        e => { s.state = "failed"; s.error = String(e.message || e).slice(0, 300); log("traction-fail web", s.paymentHash, s.error); }
      ).finally(() => { s.job = null; saveWeb(); });
      return;
    }
    const repairOut = path.join(repairDir, s.id + ".stl");
    s.job = serial(() => inspect(s.url, { repairOut })).then(
      r => { s.report = { url: s.url, ...r }; if (r && r.repair && r.repair.ok) { s.repairFile = repairOut; s.report.repair = { ...r.repair, download: "/v1/web/file?id=" + s.id }; }
        s.state = "done"; log("DELIVERED web", s.paymentHash, String(s.url).slice(0, 120), r && r.repair ? "repair=" + (r.repair.ok ? (r.repair.watertight_after ? "clean" : "partial") : "fail") : ""); },
      e => { s.state = "failed"; s.error = String(e.message || e).slice(0, 300); log("inspect-fail web", s.paymentHash, s.error); }
    ).finally(() => { s.job = null; saveWeb(); });
  };
  const checkPaid = async s => {
    if (s.state !== "unpaid") return;
    if (s.checking) return s.checking;
    if (Date.now() - (s.lastCheck || 0) < statusMinIntervalMs) return;
    const w = wallet(); if (!w) return;
    s.lastCheck = Date.now();
    s.checking = (async () => {
      let st = "";
      try { st = await withTimeout(receiveStatus(w, s.invId), statusTimeoutMs, "getLightningReceiveRequest"); }
      catch (e) { log("web-status-fail", s.paymentHash, String(e.message || e).replace(/\s+/g, " ").slice(0, 160)); return; }
      if (s.state !== "unpaid") return;
      if (PAID_RE.test(st)) { s.state = "paid"; s.paidAt = Date.now(); markUsed(s.paymentHash); log("web-paid", s.paymentHash, st); saveWeb(); startJob(s); }
      else if (Date.now() > s.expires + 120000) { s.state = "expired"; log("web-expired", s.paymentHash); saveWeb(); }
    })().finally(() => { s.checking = null; });
    return s.checking;
  };
  const webView = s => ({ id: s.id, kind: s.kind || "inspect", state: s.state, paid: !!s.paidAt, url: s.url, price_sats: PRICE, expires: new Date(s.expires).toISOString(),
    ...(s.state === "unpaid" ? { bolt11: s.pr, qr_svg: qrSvg(s.pr) } : {}), ...(s.report ? { report: s.report } : {}), ...(s.error ? { error: s.error } : {}),
    ...(s.state === "working" || s.state === "paid" ? { queued } : {}) });
  const qrSvg = pr => { try { return renderSVG(String(pr).toUpperCase(), { ecc: "M", border: 2 }); } catch { return ""; } };
  const wantsHtml = req => { const a = String(req.headers.accept || "").toLowerCase(); const h = a.indexOf("text/html"); if (h < 0) return false; const jx = a.indexOf("application/json"); return jx < 0 || h < jx; };
  const html = (res, body) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "vary": "Accept", "cache-control": "no-cache",
    "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" }); res.end(body); };
  const readSmall = async (req, max = 4096) => { const b = await readBody(req, max); const ct = (req.headers["content-type"] || "").toLowerCase();
    if (!b.length) return {};
    if (ct.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(b.toString("utf8")));
    try { return JSON.parse(b.toString("utf8")); } catch { return null; } };
  const j = (res, code, o, h = {}) => { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-expose-headers": "WWW-Authenticate", ...h }); res.end(JSON.stringify(o, null, 1) + "\n"); };
  const base = req => `https://${req.headers["x-forwarded-host"] || req.headers.host || "127.0.0.1:8796"}`;
  const info = req => {
    const b = base(req);
    return {
      name: "Hexbox 3D model inspect",
      what: "Send a public https link to a 3D file, or POST the file bytes after paying, and get back what is inside it as JSON: printability (watertight or not, open/non-manifold edges, flipped or inside-out faces, loose geometry, shells, volume), triangles, vertices, n-gons, materials, textures and their sizes, bounds and real size, missing UVs or materials, unapplied transforms, animations, and plain warnings (wrong scale, not on the ground, too heavy for real-time). Read-only. Nothing is stored.",
      formats: ["glb", "gltf (embedded)", "fbx", "obj", "stl", "ply", "usd/usdc", "blend", "zip containing one of these"],
      endpoint: `${b}/v1/model/inspect?url=<https link to the file>`, method: "GET or POST. After paying: POST raw bytes (Content-Type application/octet-stream + X-Filename), multipart file, JSON {\"url\"}, or JSON {\"file_b64\",\"filename\"}",
      price_sats: PRICE, payment: "L402. First request returns 402 with a Lightning invoice and a macaroon. Pay, then repeat with header 'Authorization: L402 <macaroon>:<preimage>' and either ?url= or a file body. One paid token = one successful inspect, valid 1 hour. If the file can't be read you get 422 and the token stays unused. Do not upload the file before paying.",
      limits: "200 MB, 3 minutes",
      also: { funding: { endpoint: `${b}/v1/funding?coin=BTC`, price_sats: PRICE, checkout_page: `${b}/funding`, ...(fundingSample ? { free_example: `${b}/v1/funding/sample` } : {}), what: "Perp funding across 10 venues (Binance, Bybit, OKX, Bitget, Gate, MEXC, KuCoin, Deribit, Kraken, Hyperliquid) in one call: rates normalised to 8h and APR, next funding, mark, open interest, OI-weighted average, highest/lowest venue and spread; for BTC/ETH also Deribit DVOL vs 7d/30d realised vol. BTC, ETH, SOL, XRP, DOGE, BNB, LTC, ADA, AVAX, LINK, SUI, HYPE. Same L402 payment as inspect." }, trials: { endpoint: `${b}/v1/trials?q=<sponsor | $TICKER | drug:<name> | condition:<name>>`, price_sats: PRICE, checkout_page: `${b}/trials`, what: "Clinical trial pipeline check from ClinicalTrials.gov: trials by phase and status, upcoming primary completion dates (next 180 days, a readout proxy), trials still running past primary completion, live phase 3, recent registry updates, as one JSON. Same L402 payment as inspect; no matches = token unused." }, traction: { endpoint: `${b}/v1/traction?q=<product name, site or GitHub URL>`, price_sats: PRICE, checkout_page: `${b}/traction`, ...(tractionSample ? { free_example: `${b}/v1/traction/sample` } : {}), what: "Launch traction check: Hacker News stories and points (linked vs mentioned), recent Reddit posts, GitHub stars, npm weekly downloads and a 0-100 score, as one JSON. Same L402 payment as inspect." } },
      example: `lnget --max-cost ${PRICE} '${b}/v1/model/inspect?url=https://example.com/chair.glb'`,
      example_upload: [
        `# 1) pay first (tiny probe — do NOT send the file yet)`,
        `curl -i -X POST ${b}/v1/model/inspect -H 'Content-Type: application/json' -d '{}'`,
        `# 2) after paying the 402 invoice, upload with L402 macaroon:preimage`,
        `curl -sS -X POST ${b}/v1/model/inspect -H "Authorization: L402 <macaroon>:<preimage>" -H 'Content-Type: application/octet-stream' -H 'X-Filename: chair.glb' --data-binary @chair.glb`,
        `# alt: multipart`,
        `curl -sS -X POST ${b}/v1/model/inspect -H "Authorization: L402 <macaroon>:<preimage>" -F file=@chair.glb`,
      ],
      operator: "Hexbox Tools. Lightning: " + (process.env.LN_ADDRESS || "you@example.com") + "",
      // Oct 15: agent-crawler discovery (no external directory). Same shape some 31990 cards advertise.
      checkout_page: `${b}/try`, llms_txt: `${b}/llms.txt`, openapi: `${b}/openapi.json`, ai_plugin: `${b}/.well-known/ai-plugin.json`,
    };
  };
  const openapi = req => {
    const b = base(req), ep = `${b}/v1/model/inspect`;
    return {
      openapi: "3.0.3",
      info: { title: "Hexbox 3D model inspect", version: "1.0.0", description: info(req).what + " Paid via L402 Lightning (21 sats). Humans without a preimage: " + b + "/try . Operator: Hexbox Tools. lud16 " + (process.env.LN_ADDRESS || "you@example.com"), contact: { name: "Hexbox Tools", url: b } },
      servers: [{ url: b }],
      paths: {
        "/v1/model/inspect": {
          get: {
            operationId: "inspectModel", summary: "Inspect a public 3D file (L402)",
            parameters: [{ name: "url", in: "query", required: true, schema: { type: "string", format: "uri" }, description: "https URL of a glb/gltf/fbx/obj/stl/ply/usd/blend (or zip of one)" }],
            responses: {
              "200": { description: "JSON mesh/material/UV/scale report" },
              "402": { description: "Payment required. WWW-Authenticate: L402 macaroon=..., invoice=lnbc..." },
              "401": { description: "Bad L402 Authorization" },
              "422": { description: "File unreadable; token unused" },
              "503": { description: "Wallet/tunnel restarting" },
            },
            security: [{ l402: [] }],
          },
          post: {
            operationId: "inspectModelPost", summary: "URL JSON, base64 JSON, raw bytes, or multipart file (L402)",
            parameters: [{ name: "X-Filename", in: "header", required: false, schema: { type: "string" }, description: "Original filename when body is application/octet-stream (e.g. chair.glb). Also accepts X-File-Name or ?filename=" }],
            requestBody: { required: false, content: {
              "application/json": { schema: { type: "object", properties: { url: { type: "string", format: "uri" }, file_b64: { type: "string", description: "base64 file bytes (prefer raw/multipart for large files)" }, filename: { type: "string" } } } },
              "application/octet-stream": { schema: { type: "string", format: "binary" } },
              "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } },
            } },
            responses: {
              "200": { description: "JSON mesh/material/UV/scale report" },
              "402": { description: "Payment required. WWW-Authenticate: L402 macaroon=..., invoice=lnbc..." },
              "401": { description: "Bad L402 Authorization" },
              "422": { description: "File unreadable; token unused" },
              "503": { description: "Wallet/tunnel restarting" },
            },
            security: [{ l402: [] }],
          },
        },
        "/v1/funding": {
          get: {
            operationId: "fundingSnapshot", summary: "Cross-exchange perpetual funding rate + open interest snapshot, 10 venues, one call (L402)",
            parameters: [{ name: "coin", in: "query", required: false, schema: { type: "string", default: "BTC", enum: ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB", "LTC", "ADA", "AVAX", "LINK", "SUI", "HYPE"] } }],
            responses: {
              "200": { description: "JSON: per-venue rate, 8h-normalised rate, APR, next funding, mark, OI USD; summary with OI-weighted 8h rate, highest/lowest venue, spread (8h and APR), negative venues, mark dispersion; BTC/ETH add vol {dvol, dvol_24h_change, realised_7d, realised_30d, implied_minus_realised_30d, implied_daily_move_pct}" },
              "402": { description: "Payment required. WWW-Authenticate: L402 macaroon=..., invoice=lnbc..." },
              "401": { description: "Bad L402 Authorization" }, "422": { description: "Unsupported coin or fewer than 2 venues answered; token unused" }, "503": { description: "Wallet/tunnel restarting" },
            },
            security: [{ l402: [] }],
          },
        },
        ...(fundingSample ? { "/v1/funding/sample": { get: { operationId: "fundingSample", summary: "Free saved example of a paid funding snapshot (BTC; no payment, no input; same JSON shape under report, plus checkedAt). Not a live check.", responses: { "200": { description: "JSON {example:true, live:false, checkedAt, note, report}" } }, security: [] } } } : {}),
        "/v1/trials": {
          get: {
            operationId: "trialsCheck", summary: "Clinical trial pipeline summary for a sponsor, stock ticker ($VKTX), drug or condition from ClinicalTrials.gov (L402)",
            parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" }, description: "Sponsor name (e.g. Viking Therapeutics), a ticker ($VKTX or ticker:VKTX, lead-sponsored trials only), drug:<name>, or condition:<name>" }],
            responses: {
              "200": { description: "JSON: counts by phase/status, top sponsors, upcoming primary completion (-30..+180 d), overdue (estimated primary completion passed, never updated) trials, primary-done-still-active count, live phase 3+, recently updated" },
              "400": { description: "Missing q; token unused" }, "402": { description: "Payment required. WWW-Authenticate: L402 macaroon=..., invoice=lnbc..." },
              "401": { description: "Bad L402 Authorization" }, "422": { description: "No matches or upstream failed; token unused" }, "503": { description: "Wallet/tunnel restarting" },
            },
            security: [{ l402: [] }],
          },
        },
        "/v1/traction": {
          get: {
            operationId: "tractionCheck", summary: "Launch traction check for a product name, site or GitHub URL (L402)",
            parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" }, description: "Product name, domain (e.g. plausible.io) or GitHub repo URL" }],
            responses: {
              "200": { description: "JSON: Hacker News stories/points (linked vs mentioned), recent Reddit posts, GitHub stars, npm weekly downloads, 0-100 score" },
              "400": { description: "Missing q; token unused" },
              "402": { description: "Payment required. WWW-Authenticate: L402 macaroon=..., invoice=lnbc..." },
              "401": { description: "Bad L402 Authorization" },
              "422": { description: "Check failed; token unused" },
              "503": { description: "Wallet/tunnel restarting" },
            },
            security: [{ l402: [] }],
          },
        },
        ...(tractionSample ? { "/v1/traction/sample": { get: { operationId: "tractionSample", summary: "Free saved example of a paid traction result (no payment, no input; same JSON shape under report, plus checkedAt). Not a live check.", responses: { "200": { description: "JSON {example:true, checkedAt, note, report}" } }, security: [] } } } : {}),
        "/health": { get: { operationId: "health", summary: "Liveness (no payment)", responses: { "200": { description: "ok" }, "503": { description: "wedged" } } } },
        "/llms.txt": { get: { operationId: "llmsTxt", summary: "Plain-text agent card", responses: { "200": { description: "text/plain" } } } },
        "/funding": { get: { operationId: "fundingCheckout", summary: "Human browser checkout for the funding snapshot (POST /v1/web/start with {kind:\"funding\", q:\"BTC\"})", responses: { "200": { description: "HTML page" } } } },
        "/trials": { get: { operationId: "trialsCheckout", summary: "Human browser checkout for the clinical trial pipeline check (POST /v1/web/start with {kind:\"trials\", q})", responses: { "200": { description: "HTML page" } } } },
        "/traction": { get: { operationId: "tractionCheckout", summary: "Human browser checkout for the launch traction check (POST /v1/web/start with {kind:\"traction\", q})", responses: { "200": { description: "HTML page" } } } },
        "/try": { get: { operationId: "browserCheckout", summary: "Human browser checkout (QR / bolt11, no preimage)", responses: { "200": { description: "HTML page" } } } },
        "/v1/web/start": { post: { operationId: "webStart", summary: "Start a browser checkout session (own invoice)", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["url"], properties: { url: { type: "string", format: "uri" }, kind: { type: "string", enum: ["inspect", "traction", "trials", "funding"], description: "omit for inspect; traction/trials/funding take q instead of url" }, q: { type: "string", description: "query for traction/trials, or the coin for funding (BTC, ETH, ...)" }, retry: { type: "string", description: "prior failed session id" } } } } } }, responses: { "200": { description: "session id + bolt11" }, "400": { description: "bad url" }, "429": { description: "rate limited" }, "503": { description: "wallet/busy" } } } },
        "/v1/web/status": { get: { operationId: "webStatus", summary: "Poll browser checkout (unpaid → paid → report)", parameters: [{ name: "id", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "session view" }, "404": { description: "unknown/expired" } } } },
      },
      components: { securitySchemes: { l402: { type: "apiKey", in: "header", name: "Authorization", description: "L402 <macaroon>:<preimage> after paying the 402 invoice" } } },
      "x-payment": { protocol: "L402", price_sats: PRICE, lud16: (process.env.LN_ADDRESS || "you@example.com") },
    };
  };
  const aiPlugin = req => {
    const b = base(req);
    return {
      schema_version: "v1", name_for_human: "Hexbox 3D model inspect", name_for_model: "hexbox_model_inspect",
      description_for_human: "Pay-per-call Lightning (L402) inspect of a 3D file (public https URL or upload after pay). 21 sats. Humans: open /try — paste a link, pay with any Lightning wallet, get the report (no preimage).",
      description_for_model: "Call GET " + b + "/v1/model/inspect (or with ?url=<https 3D file>). First response is HTTP 402 with WWW-Authenticate L402 macaroon and a bolt11 invoice (21 sats). Pay, then retry with Authorization: L402 <macaroon>:<preimage> and either ?url= or POST the file (octet-stream + X-Filename, multipart, or JSON file_b64). Returns JSON mesh/material stats. Read-only. Do not upload before paying.",
      auth: { type: "none" }, api: { type: "openapi", url: b + "/openapi.json" },
      logo_url: "https://blossom.primal.net/a89fcde715b8199d0bc0f89f56d03c06bf88abb8e0de360096a0d3c96783e295.png",
      contact_email: (process.env.LN_ADDRESS || "you@example.com"), legal_info_url: b + "/llms.txt",
    };
  };
  const refreshChallenge = async (w) => {
    const minted = await mintInvoice(w);
    const mac = makeMacaroon({ rootKey, paymentHash: minted.paymentHash, service: SERVICE, ttlSec: TTL });
    lastChallenge = { mac, pr: minted.pr, paymentHash: minted.paymentHash, invId: minted.inv.id, at: Date.now() };
    if (invFails) log("invoice-recovered after", invFails, "failure(s)"); invFails = 0; firstFailAt = 0;
    return lastChallenge;
  };
  // Oct 16 7:25 PM ET: funnel visibility. Log GET views of the human/agent discovery pages
  // (no IP, referrer host only, UA trimmed), capped at 120 lines an hour so crawlers can't flood l402.log.
  const VIEW_PATHS = new Set(["/try", "/trials", "/traction", "/traction/card.png", "/v1/traction/sample", "/funding", "/v1/funding/sample", "/", "/v1", "/llms.txt", "/openapi.json", "/.well-known/ai-plugin.json"]);
  let viewHour = 0, viewCount = 0;
  const logView = (req, u) => {
    const h = Math.floor(Date.now() / 3600000); if (h !== viewHour) { viewHour = h; viewCount = 0; }
    if (++viewCount > 120) return;
    let ref = "-"; try { ref = new URL(req.headers.referer || "").host || "-"; } catch {}
    log("view", u.pathname, wantsHtml(req) ? "html" : "data", ref, (req.headers["user-agent"] || "-").replace(/\s+/g, " ").slice(0, 60));
  };
  const handler = async (req, res) => {
    try {
      const u = new URL(req.url, "http://x");
      if (req.method === "GET" && VIEW_PATHS.has(u.pathname)) { try { logView(req, u); } catch {} }
      if (req.method === "OPTIONS") return j(res, 204, {}, { "access-control-allow-headers": "Authorization, Content-Type", "access-control-allow-methods": "GET, POST, OPTIONS" });
      if (u.pathname === "/try" || (u.pathname === "/" && wantsHtml(req))) return html(res, pageHtml({ price: PRICE }));
      if (u.pathname === "/trials") return html(res, trialsPageHtml({ price: PRICE, baseUrl: publicBase(req) }));
      if (u.pathname === "/funding") return html(res, fundingPageHtml({ price: PRICE, sample: fundingSample, baseUrl: publicBase(req) }));
      if (u.pathname === "/v1/funding/sample") return fundingSample ? j(res, 200, fundingSample, { "cache-control": "public, max-age=300" }) : j(res, 404, { error: "no example saved" });
      if (u.pathname === "/traction") return html(res, tractionPageHtml({ price: PRICE, sample: tractionSample, baseUrl: publicBase(req), card: !!tractionCard }));
      if (u.pathname === "/traction/card.png") {
        if (!tractionCard) return j(res, 404, { error: "no card" });
        res.writeHead(200, { "content-type": "image/png", "content-length": tractionCard.length, "cache-control": "public, max-age=3600", "access-control-allow-origin": "*", "x-content-type-options": "nosniff" });
        return res.end(req.method === "HEAD" ? undefined : tractionCard);
      }
      if (u.pathname === "/v1/traction/sample") return tractionSample ? j(res, 200, tractionSample, { "cache-control": "public, max-age=300" }) : j(res, 404, { error: "no example saved" });
      if (u.pathname === "/" || u.pathname === "/v1") return j(res, 200, info(req), u.pathname === "/" ? { vary: "Accept" } : {});
      if (u.pathname === "/v1/web/start") {
        if (req.method !== "POST") return j(res, 405, { error: "POST {\"url\"}" }, { allow: "POST" });
        let o; try { o = await readSmall(req); } catch (e) { return j(res, 413, { error: "body too big" }); }
        if (!o || typeof o !== "object") return j(res, 400, { error: "send JSON {\"url\": \"https://...\"}" });
        const isF = o.kind === "funding", isTr = o.kind === "trials", isT = o.kind === "traction" || isTr || isF; // isT = free-text query kinds
        const kind = isF ? "funding" : isTr ? "trials" : isT ? "traction" : "inspect";
        let url = isT ? (typeof (isF ? (o.q ?? o.coin) : o.q) === "string" ? String(isF ? (o.q ?? o.coin) : o.q).trim() : "") : typeof o.url === "string" ? o.url.trim() : "";
        if (isF) { url = url.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(USDT?|PERP)$/, "");
          if (!FUNDING_COINS.includes(url)) return j(res, 400, { error: "pick one of " + FUNDING_COINS.join(", ") }); }
        if (!url) return j(res, 400, { error: isTr ? "type a sponsor, a drug or a condition" : isT ? "type a product name, a site or a GitHub link" : "paste a link to the file" });
        if (url.length > (isT ? 200 : 2000)) return j(res, 400, { error: isT ? "that's too long; a name or one link is enough" : "that link is too long" });
        if (!isT) { const bad = await checkUrl(url, { allowLocal }); if (bad) return j(res, 400, { error: bad }); }
        sweepWeb();
        if (o.retry) { // paid session whose file failed: run again on the same payment with a new link
          const s = web.get(String(o.retry));
          if (!s || s.state !== "failed" || (s.kind || "inspect") !== kind) return j(res, 409, { error: "nothing to retry on that checkout" });
          if ((s.retries = (s.retries || 0) + 1) > 5) return j(res, 429, { error: "that's five links on one payment; start a new checkout" });
          s.url = url; s.error = null; log("web-retry", s.paymentHash, url.slice(0, 120)); startJob(s); saveWeb();
          return j(res, 200, webView(s));
        }
        const ip = clientIp(req);
        if (!rateOk(ip)) { log("web-ratelimit", ipTag(req)); return j(res, 429, { error: "too many invoices from here, wait a few minutes" }, { "retry-after": "120" }); }
        if (web.size >= webMax) return j(res, 503, { error: "busy, try again in a few minutes" }, { "retry-after": "120" });
        const w = wallet(); if (!w) return j(res, 503, { error: "payments are starting up, try again in 30 seconds" }, { "retry-after": "30" });
        if (wedged) return j(res, 503, { error: "payments are restarting, try again in a minute" }, { "retry-after": "30" });
        let m; try { m = await mintFresh(w, isF ? "Hexbox Tools funding snapshot" : isTr ? "Hexbox Tools clinical trial check" : isT ? "Hexbox Tools launch traction check" : "Hexbox Tools 3D file check"); }
        catch (e) { invoiceFailed(e.message); return j(res, 503, { error: "couldn't make an invoice right now, try again in a minute" }, { "retry-after": "30" }); }
        if (invFails) log("invoice-recovered after", invFails, "failure(s)"); invFails = 0; firstFailAt = 0;
        if (used.has(m.paymentHash) || [...web.values()].some(x => x.paymentHash === m.paymentHash)) { log("web-dup-hash", m.paymentHash); return j(res, 503, { error: "try again" }); }
        const s = { id: crypto.randomBytes(16).toString("hex"), url, invId: m.inv.id, pr: m.pr, paymentHash: m.paymentHash, created: Date.now(), expires: Date.now() + 900000, state: "unpaid", ...(isT ? { kind } : {}) };
        web.set(s.id, s); saveWeb();
        log("web-start", s.id.slice(0, 8), kind, m.inv.id, m.paymentHash, ipTag(req), url.slice(0, 120));
        return j(res, 200, { ...webView(s), lightning_uri: "lightning:" + m.pr });
      }
      if (u.pathname === "/v1/web/status") {
        const s = web.get(String(u.searchParams.get("id") || ""));
        if (!s) return j(res, 404, { error: "unknown or expired checkout" });
        if (s.state === "unpaid") await checkPaid(s);
        if (s.state === "paid" && !s.job) startJob(s); // e.g. after a restart
        return j(res, 200, webView(s), { "cache-control": "no-store" });
      }
      if (u.pathname === "/v1/web/file") {
        const s = web.get(String(u.searchParams.get("id") || ""));
        if (!s || s.state !== "done" || !s.repairFile || !fs.existsSync(s.repairFile)) return j(res, 404, { error: "no repaired file for that checkout (it may have expired)" });
        const base0 = (String(s.url).split(/[?#]/)[0].split("/").pop() || "model").replace(/\.[a-z0-9]+$/i, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60) || "model";
        res.writeHead(200, { "content-type": "model/stl", "content-disposition": `attachment; filename="${base0}-repaired.stl"`, "cache-control": "no-store", "x-content-type-options": "nosniff" });
        log("web-file", s.paymentHash);
        return fs.createReadStream(s.repairFile).pipe(res);
      }
      if (u.pathname === "/llms.txt") {
        const i = info(req);
        const up = (i.example_upload || []).join("\n");
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        return res.end(`# ${i.name}\n\n${i.what}\n\nEndpoint: ${i.endpoint}\nPrice: ${i.price_sats} sats per inspect\nPayment: ${i.payment}\nFormats: ${i.formats.join(", ")}\nLimits: ${i.limits}\n\n## Browser (no preimage needed)\nHumans: open ${i.checkout_page} — paste a file link, pay 21 sats (QR / bolt11 / WebLN), get the report on the page. Agents keep using L402 below.\n\n## Example (public URL)\n${i.example}\n\n## Example (upload after pay — no public URL needed)\nPay a small probe first (empty JSON POST or GET without a huge body). Unpaid bodies over 10 KB are rejected (413). Then POST the file with Authorization.\n\n${up}\n\n## Also: launch traction check (same L402 token rules, ${i.price_sats} sats)\nGET ${i.also.traction.endpoint}\n${i.also.traction.what}\nHumans: ${i.also.traction.checkout_page} (pay in the browser, no preimage)\n${i.also.traction.free_example ? `Free example (no payment, saved result, not a live check): GET ${i.also.traction.free_example}\n` : ""}\n## Also: cross-exchange funding snapshot (same L402 token rules, ${i.price_sats} sats)\nGET ${i.also.funding.endpoint}\n${i.also.funding.what}\nHumans: ${i.also.funding.checkout_page} (pay in the browser, no preimage)\n${i.also.funding.free_example ? `Free example (no payment, saved BTC result, not a live check): GET ${i.also.funding.free_example}\n` : ""}\n## Also: clinical trial pipeline check (same L402 token rules, ${i.price_sats} sats)\nGET ${i.also.trials.endpoint}\n${i.also.trials.what}\nHumans: ${i.also.trials.checkout_page} (pay in the browser, no preimage)\n\nOpenAPI: ${i.openapi}\nAI plugin: ${i.ai_plugin}\nCheckout: ${i.checkout_page}\n`);
      }
      if (u.pathname === "/openapi.json") return j(res, 200, openapi(req));
      if (u.pathname === "/.well-known/ai-plugin.json") return j(res, 200, aiPlugin(req));
      // Oct 15: 402index domain verify — serve ONLY the hash (token stays private under /workspace/l402/)
      if (u.pathname === "/.well-known/402index-verify.txt") {
        const hashFile = path.join(HERE, "402index-verify-hash.txt");
        if (!fs.existsSync(hashFile)) return j(res, 404, { error: "verify file not set" });
        const hash = fs.readFileSync(hashFile, "utf8").trim();
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        return res.end(hash);
      }
      if (u.pathname === "/health") return j(res, wedged ? 503 : 200, { ok: !wedged, wallet: !!wallet(), queued, invoice_fails: invFails, web_sessions: web.size });
      // Oct 16: /v1/inspect alias (402index relisting; old path soft-deleted there)
      // Oct 17: /v1/traction = launch traction check (HN + Reddit + GitHub + npm for a name/URL). Same L402 token and price as inspect.
      const isTraction = u.pathname === "/v1/traction";
      // Oct 17 R51: /v1/trials = ClinicalTrials.gov pipeline summary (sponsor / drug / condition). Browser checkout at /trials since R52. Same token + price.
      const isTrials = u.pathname === "/v1/trials";
      // Oct 18 R65: /v1/funding = cross-exchange perp funding + OI snapshot (10 venues). Same token + price. Demand: SN 1593899.
      const isFunding = u.pathname === "/v1/funding";
      if (u.pathname !== "/v1/model/inspect" && u.pathname !== "/v1/inspect" && !isTraction && !isTrials && !isFunding) return j(res, 404, { error: "not found", see: "/" });
      if (isFunding && req.headers.authorization) {
        const q = String(u.searchParams.get("coin") || u.searchParams.get("q") || "BTC").trim().slice(0, 20);
        const v = verifyAuth(req.headers.authorization, { rootKey, service: SERVICE, isUsed: h => used.has(h) });
        if (v.ok) {
          try {
            const r = await fundingFn(q);
            markUsed(v.paymentHash); log("DELIVERED-funding", v.paymentHash, q);
            return j(res, 200, r);
          } catch (e) { log("funding-fail", v.paymentHash, e.message); return j(res, 422, { error: "couldn't build the snapshot: " + e.message, token: "still unused" }); }
        }
        log("auth-reject", v.error);
        if (v.error !== "token already used" && v.error !== "token expired") return j(res, 401, { error: v.error });
      }
      if (isTrials && req.headers.authorization) {
        const q = String(u.searchParams.get("q") || "").trim().slice(0, 200);
        const v = verifyAuth(req.headers.authorization, { rootKey, service: SERVICE, isUsed: h => used.has(h) });
        if (v.ok) {
          if (q.replace(/^(sponsor|drug|condition)\s*:\s*/i, "").length < 2) return j(res, 400, { error: "add ?q=<sponsor>, ?q=drug:<name> or ?q=condition:<name>. Your token is still unused." });
          try {
            const r = await trialsFn(q);
            if (!r || !r.analyzed) return j(res, 422, { error: "no trials found for that on ClinicalTrials.gov. Try the sponsor's registered name, or drug:/condition:", token: "still unused" });
            markUsed(v.paymentHash); log("DELIVERED-trials", v.paymentHash, q.slice(0, 120));
            return j(res, 200, r);
          } catch (e) { log("trials-fail", v.paymentHash, e.message); return j(res, 422, { error: "couldn't check that: " + e.message, token: "still unused" }); }
        }
        log("auth-reject", v.error);
        if (v.error !== "token already used" && v.error !== "token expired") return j(res, 401, { error: v.error });
      }
      if (isTraction && req.headers.authorization) {
        const q = String(u.searchParams.get("q") || u.searchParams.get("url") || "").trim().slice(0, 200);
        const v = verifyAuth(req.headers.authorization, { rootKey, service: SERVICE, isUsed: h => used.has(h) });
        if (v.ok) {
          if (!q) return j(res, 400, { error: "add ?q=<product name, site or GitHub URL>. Your token is still unused." });
          try {
            const r = await tractionFn(q);
            markUsed(v.paymentHash); log("DELIVERED-traction", v.paymentHash, q.slice(0, 120));
            return j(res, 200, r);
          } catch (e) { log("traction-fail", v.paymentHash, e.message); return j(res, 422, { error: "couldn't check that: " + e.message, token: "still unused" }); }
        }
        log("auth-reject", v.error);
        if (v.error !== "token already used" && v.error !== "token expired") return j(res, 401, { error: v.error });
      }
      const authHdr = req.headers.authorization || "";
      const cl = +(req.headers["content-length"] || 0);
      const wantsUpload = cl > 10000 || /multipart\/form-data|octet-stream|model\/|application\/(fbx|sla|dicom)|gltf/i.test(req.headers["content-type"] || "");
      // Unpaid clients must not push a 200 MB body. Pay first (small GET/POST), then upload with Authorization.
      if (!authHdr && wantsUpload) {
        if (cl > 10000) { try { req.resume(); } catch {} }
        // fall through to mint a challenge below after a tiny drain when needed
      }
      let bodyBuf = Buffer.alloc(0);
      try {
        const max = authHdr ? MAX_UPLOAD : 10000;
        if (cl > max) return j(res, 413, { error: authHdr ? "body over 200 MB" : "pay first (GET this endpoint), then POST the file with Authorization. Unpaid body limit is 10 KB." });
        bodyBuf = await readBody(req, max);
      } catch (e) {
        if (e.code === 413) return j(res, 413, { error: authHdr ? "body over 200 MB" : "pay first, then POST the file with Authorization. Unpaid body limit is 10 KB." });
        throw e;
      }
      const ct = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      let target = (isTraction || isTrials || isFunding) ? null : u.searchParams.get("url");
      let upload = null; // { bytes, name }
      if (!target && bodyBuf.length) {
        if (ct === "application/json" || (!ct && bodyBuf[0] === 0x7b)) {
          let o; try { o = JSON.parse(bodyBuf.toString("utf8")); } catch { return j(res, 400, { error: "body must be JSON {\"url\"} or {\"file_b64\",\"filename\"}" }); }
          if (o.url) target = o.url;
          else if (o.file_b64) {
            try { upload = { bytes: Buffer.from(o.file_b64, "base64"), name: o.filename || o.name || "upload.bin" }; }
            catch { return j(res, 400, { error: "file_b64 is not valid base64" }); }
          } else return j(res, 400, { error: "JSON needs \"url\" or \"file_b64\"" });
        } else if (ct.startsWith("multipart/")) {
          try { upload = parseMultipartFile(bodyBuf, req.headers["content-type"]); }
          catch (e) { return j(res, 400, { error: e.message }); }
        } else if (ct === "application/octet-stream" || ct.startsWith("model/") || ct === "application/fbx" || ct === "application/sla" || bodyBuf.length > 0 && authHdr) {
          const name = req.headers["x-filename"] || req.headers["x-file-name"] || u.searchParams.get("filename") || "upload.bin";
          if (bodyBuf.length) upload = { bytes: bodyBuf, name: String(name).slice(0, 200) };
        } else if (bodyBuf.length) {
          return j(res, 400, { error: "unsupported Content-Type; use application/json, multipart/form-data, or application/octet-stream" });
        }
      }
      if (target) { const bad = await checkUrl(target, { allowLocal }); if (bad) return j(res, 400, { error: bad }); }
      if (upload && upload.bytes.length > MAX_UPLOAD) return j(res, 413, { error: "file over 200 MB" });
      const auth = (isTraction || isTrials || isFunding) ? "" : authHdr;
      if (auth) {
        const v = verifyAuth(auth, { rootKey, service: SERVICE, isUsed: h => used.has(h) });
        if (v.ok) {
          // Oct 16: a paid call with no file (mystery shoppers, first-time agents) used to get a 400 after paying.
          // Now it gets a real report for our sample model, and the token stays good for one inspect of their own file.
          if (!target && !upload) {
            let sample = null; try { sample = JSON.parse(fs.readFileSync(path.join(HERE, "sample-report.json"), "utf8")); } catch {}
            log("DELIVERED-sample", v.paymentHash);
            if (sample) return j(res, 200, { sample: true, note: "No ?url= or file was sent, so this is the report for our sample model (the Khronos glTF duck). Your token is still unused: repeat the call with ?url=<https link to your 3D file> or POST the file within the hour for your own report.", ...sample });
            return j(res, 400, { error: "add ?url=<https link> or POST the file body. Your token is still unused." });
          }
          if (queued >= 4) return j(res, 503, { error: "busy, try again in a minute. Token still unused." }, { "retry-after": "60" });
          try {
            const arg = upload || target;
            const r = await serial(() => inspect(arg));
            const label = target || ("upload:" + (upload?.name || "bin"));
            markUsed(v.paymentHash); log("DELIVERED", v.paymentHash, String(label).slice(0, 120));
            return j(res, 200, { ...(target ? { url: target } : { uploaded: upload?.name || "file" }), ...r });
          } catch (e) { log("inspect-fail", v.paymentHash, e.message); return j(res, 422, { error: "couldn't inspect that: " + e.message, token: "still unused, retry with another link or file" }); }
        }
        log("auth-reject", v.error);
        if (v.error === "token already used" || v.error === "token expired") { /* fall through to a fresh challenge */ }
        else return j(res, 401, { error: v.error });
      }
      if (upload || (wantsUpload && !authHdr)) {
        // Unpaid upload attempt: still mint a challenge so they can pay, but tell them not to resend the file yet.
      }
      if (Date.now() - winStart > 60000) { win = 0; winStart = Date.now(); }
      if (++win > maxChallengesPerMin) return j(res, 429, { error: "too many requests" }, { "retry-after": "60" });
      const w = wallet(); if (!w) return j(res, 503, { error: "wallet starting, retry shortly" }, { "retry-after": "30" });
      if (wedged) return j(res, 503, { error: "payment backend restarting, retry in a minute" }, { "retry-after": "30" });
      // Oct 15: serialize mints. Oct 16: single-flight + short reuse + fail-fallback so Spark slowness
      // returns a still-payable 402 instead of 503 (Raikiri / agent probes during freezes).
      // Oct 16 11:31 AM: every 402 body carries checkout_page. Humans who land on /v1/inspect (agents,
      // mystery shoppers, curl) never saw /try before — only root/llms/OpenAPI did. No new announcement.
      const howPay = isFunding ? "Pay the invoice, then retry with Authorization: L402 <macaroon>:<preimage> and ?coin=BTC (or ETH, SOL, XRP, DOGE, BNB, LTC, ADA, AVAX, LINK, SUI, HYPE). Returns one JSON snapshot of perpetual funding across Binance, Bybit, OKX, Bitget, Gate, MEXC, KuCoin, Deribit, Kraken and Hyperliquid: each rate normalised to 8h and APR, next funding time, mark, open interest in USD, plus OI-weighted average, highest/lowest venue and the spread. One token = one snapshot within 1 hour; if fewer than 2 venues answer the token stays unused. Humans without a preimage: open " + base(req) + "/funding — pick a coin, pay, get the table on the page." : isTrials ? "Pay the invoice, then retry with Authorization: L402 <macaroon>:<preimage> and ?q=<sponsor> (e.g. Viking Therapeutics), ?q=$VKTX (ticker: lead-sponsored trials only), ?q=drug:<name> or ?q=condition:<name>. Returns a ClinicalTrials.gov summary as JSON: trials by phase and status, upcoming primary completion dates (next 180 days), trials still running past their primary completion date, live phase 3, recent registry updates. One token = one check within 1 hour; no matches = token unused. Humans without a preimage: open " + base(req) + "/trials — type a sponsor, drug or condition, pay, get the result on the page." : isTraction ? "Pay the invoice, then retry with Authorization: L402 <macaroon>:<preimage> and ?q=<product name, site or GitHub URL>. Returns Hacker News, Reddit, GitHub and npm signals plus a 0-100 traction score as JSON. One token = one check within 1 hour. Humans without a preimage: open " + base(req) + "/traction — type a name or link, pay, get the result on the page." : "Pay the invoice, then retry with Authorization: L402 <macaroon>:<preimage> and either ?url= or POST the file (octet-stream + X-Filename, multipart field file, or JSON file_b64). One token = one successful inspect within 1 hour. Do not upload the file before paying. Humans without a preimage: open " + base(req) + "/try — paste a link, pay, get the report on the page.";
      const reply402 = (mac, pr, paymentHash, invId, kind) => {
        log("challenge", invId || "cached", paymentHash, kind, (req.headers["user-agent"] || "").slice(0, 60));
        res.setHeader("WWW-Authenticate", challengeHeaders(mac, pr)[0]); // L402 only: tunnels comma-join duplicate headers
        return j(res, 402, { error: "payment required", price_sats: PRICE, invoice: pr, macaroon: mac, how: howPay, checkout_page: base(req) + (isFunding ? "/funding" : isTrials ? "/trials" : isTraction ? "/traction" : "/try") });
      };
      const cacheOk = (ms) => lastChallenge && (Date.now() - lastChallenge.at) < ms && !used.has(lastChallenge.paymentHash);
      if (challengeReuseMs > 0 && cacheOk(challengeReuseMs)) {
        const c = lastChallenge;
        return reply402(c.mac, c.pr, c.paymentHash, c.invId, "reuse");
      }
      // Past reuse but still inside fallback: serve payable cache NOW, remint in background.
      // Waiting on Spark here is what hung probes 25s×3 when auth stalled (14:22Z).
      // Only when reuse is enabled (reuseMs==0 means tests/callers want every request to hit Spark).
      if (challengeReuseMs > 0 && challengeFallbackMs > 0 && cacheOk(challengeFallbackMs)) {
        const c = lastChallenge;
        refreshChallenge(w).then(() => log("challenge-refresh", lastChallenge.invId, lastChallenge.paymentHash)).catch(e => {
          invoiceFailed(e.message);
          log("challenge-refresh-fail", String(e.message || e).replace(/\s+/g, " ").slice(0, 120));
        });
        return reply402(c.mac, c.pr, c.paymentHash, c.invId, "stale-serve");
      }
      try {
        const c = await refreshChallenge(w);
        return reply402(c.mac, c.pr, c.paymentHash, c.invId, upload ? "upload-intent" : target ? "with-url" : "probe");
      } catch (e) {
        invoiceFailed(e.message);
        if (challengeFallbackMs > 0 && cacheOk(challengeFallbackMs)) {
          const c = lastChallenge;
          log("challenge-fallback", c.paymentHash, String(e.message || e).replace(/\s+/g, " ").slice(0, 120));
          return reply402(c.mac, c.pr, c.paymentHash, c.invId, "fallback");
        }
        return j(res, 503, { error: "couldn't make an invoice right now, retry in a minute" }, { "retry-after": "30" });
      }
    } catch (e) { log("err", e.stack || e.message); try { j(res, 500, { error: "internal" }); } catch {} }
  };
  handler.seedChallenge = async (w) => {
    const c = await refreshChallenge(w);
    log("challenge-seed", c.invId, c.paymentHash);
    return c;
  };
  handler.challengeAgeMs = () => lastChallenge ? Date.now() - lastChallenge.at : null;
  return handler;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.on("uncaughtException", e => log("uncaught", e.message)); process.on("unhandledRejection", e => log("unhandled", String(e)));
  // Oct 15: box is paused between agent sessions; after resume the Spark session is stale (DEADLINE_EXCEEDED x3 at 04:24Z). Exit on wake so run-l402.sh restarts clean.
  (await import("../wakewatch/wakewatch.mjs")).startWakeWatch({ log });
  const rootKey = loadRootKey(path.join(HERE, "root.key"));
  let W = null;
  const wd = setTimeout(() => { log("spark init watchdog: >150s, exiting for restart"); process.exit(1); }, 150000);
  const app = createApp({ wallet: () => W, rootKey, webSessionsFile: path.join(HERE, "web-sessions.json"), onWedged: () => setTimeout(() => process.exit(5), 300) });
  http.createServer(app).listen(8796, "127.0.0.1", () => log("listening 8796"));
  const { SparkWallet } = await import("@buildonspark/spark-sdk");
  const { wallet } = await SparkWallet.initialize({ mnemonicOrSeed: fs.readFileSync((process.env.WALLET_SEED_FILE || "./secret/seed.txt"), "utf8").trim(), options: { network: "MAINNET" } });
  clearTimeout(wd); W = wallet; log("started (wallet ready)");
  // Seed a real payable challenge into lastChallenge (not a throwaway). First /v1/inspect after
  // restart is then a reuse hit; keep-warm refreshes before the 14 min fallback window goes empty.
  try {
    await withTimeout(app.seedChallenge(W), 25000, "warmupInvoice");
    log("invoice-warmup ok");
  } catch (e) { log("invoice-warmup fail", String(e.message || e).replace(/\s+/g, " ").slice(0, 160)); }
  let kwFails = 0;
  setInterval(() => {
    if (!W) return;
    const age = app.challengeAgeMs();
    if (age != null && age < 90000) return; // still inside reuse (2 min); skip
    // Oct 16 5:2x PM: keep-warm timeouts never reached invoiceFailed (mint queued behind a hung SDK call), so a stale
    // Spark session sat wedged 4+ min serving an aging invoice. 4 keep-warm fails in a row (~4 min) -> exit, run-l402.sh restarts.
    withTimeout(app.seedChallenge(W), 25000, "keepWarm").then(() => { kwFails = 0; log("challenge-keepwarm ok"); }).catch(e => {
      kwFails++; log("challenge-keepwarm fail", `#${kwFails}`, String(e.message || e).replace(/\s+/g, " ").slice(0, 120));
      if (kwFails >= 4) { log("keepwarm-wedge: 4 keep-warm failures in a row, exiting for restart"); setTimeout(() => process.exit(5), 300); }
    });
  }, 60000).unref();
}
