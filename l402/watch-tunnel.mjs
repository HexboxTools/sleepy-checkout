// Probe public L402 URL; if the liveapps tunnel is wedged (Tunnel offline HTML / no JSON) for
// consecutive checks, kill the liveapps tunnel process so run-tunnel.sh reconnects.
// Our own 402/200/503 JSON is healthy. Exit 0 always — run-tunnel-watch.sh loops.
import fs from "fs"; import { execSync } from "child_process";
const HERE = new URL(".", import.meta.url).pathname;
const LOG = process.env.TUNNEL_WATCH_LOG || HERE + "tunnel-watch.log";
const log = (...a) => fs.appendFileSync(LOG, new Date().toISOString() + " " + a.join(" ") + "\n");
const base = () => { try { return fs.readFileSync(HERE + "base.url", "utf8").trim(); } catch { return ""; } };
const FAILF = HERE + "tunnel-watch.fails";
const readFails = () => { try { return +fs.readFileSync(FAILF, "utf8") || 0; } catch { return 0; } };
const writeFails = n => fs.writeFileSync(FAILF, String(n));

// Wake awareness: the box is frozen between agent sessions. If our last run was >120 s ago, the box
// just woke and the liveapps tunnel has almost surely lost its heartbeat, so one failed probe is enough.
const LASTF = HERE + "tunnel-watch.last";
const nowS = Math.floor(Date.now() / 1000);
let lastS = 0; try { lastS = +fs.readFileSync(LASTF, "utf8") || 0; } catch {}
try { fs.writeFileSync(LASTF, String(nowS)); } catch {}
const woke = lastS > 0 && nowS - lastS > +(process.env.TUNNEL_WAKE_S || 120);

const url = base();
if (!url) { log("skip: no base.url"); process.exit(0); }
const probe = url.replace(/\/$/, "") + "/health";
let status = 0, body = "", err = "";
try {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  const r = await fetch(probe, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": "hexbox-tunnel-watch/1" } });
  clearTimeout(t);
  status = r.status;
  body = await r.text();
} catch (e) { err = e.message || String(e); }

const looksJson = /^\s*\{/.test(body);
const offlineHtml = /tunnel\s*offline|reservation_expired|subdomain_taken|no server is connected|bad gateway|cloudflare/i.test(body) && !looksJson;
const ourJson = looksJson && (/"ok"\s*:/.test(body) || /"error"\s*:/.test(body) || /"wallet"\s*:/.test(body));
// Healthy: our server answered (even invoice 503 / wedged-spark 503). Unhealthy: transport/HTML/fail.
const healthy = !err && ourJson && !offlineHtml;

if (healthy) {
  if (readFails()) log("recovered after", readFails(), "fail(s)", "http", status, probe);
  writeFails(0);
  process.exit(0);
}

const n = readFails() + 1;
writeFails(n);
log("fail", `#${n}`, err || `http ${status}`, offlineHtml ? "tunnel-html" : looksJson ? "weird-json" : "not-json", probe.slice(0, 80));

// Need 2 consecutive fails (~3 min with 90s interval) before kill, to ride brief flaps.
if (woke && n < 2) log("wake gap", nowS - lastS, "s: killing on first fail");
// liveapps client prints "heartbeat timeout: server stopped pinging" to tunnel.log when its socket
// dies (typical right after a box freeze) but never exits. If that's the newest tunnel.log line,
// the tunnel is dead for sure: kill on the first failed probe instead of waiting ~3 min.
let hbDead = false;
try {
  const tl = fs.readFileSync(HERE + "tunnel.log", "utf8").trimEnd().split("\n").slice(-3);
  const last = tl[tl.length - 1] || "";
  hbDead = /heartbeat timeout/i.test(last);
} catch {}
if (hbDead && n < 2) log("tunnel.log shows heartbeat timeout: killing on first fail");
if (n < 2 && !woke && !hbDead) process.exit(0);

let killed = 0;
try {
  const out = execSync(`pgrep -af '${process.env.TUNNEL_PGREP || "liveapps/dist/cli.js tunnel"}' || true`, { encoding: "utf8" });
  for (const line of out.split("\n")) {
    const m = line.match(/^(\d+)\s/);
    if (!m || /pgrep/.test(line)) continue;
    const pid = +m[1];
    if (!pid || pid === process.pid) continue;
    try { process.kill(pid, "SIGTERM"); killed++; log("killed liveapps tunnel pid", pid); } catch (e) { log("kill-fail", pid, e.message); }
  }
} catch (e) { log("pgrep-fail", e.message); }
// liveapps traps SIGTERM and a wedged one never exits (seen 06:21Z Oct 15): escalate to SIGKILL.
if (killed) {
  const pids = [];
  for (const line of execSync(`pgrep -af '${process.env.TUNNEL_PGREP || "liveapps/dist/cli.js tunnel"}' || true`, { encoding: "utf8" }).split("\n")) {
    const m = line.match(/^(\d+)\s/); if (m && +m[1] !== process.pid && !/pgrep/.test(line)) pids.push(+m[1]);
  }
  const deadline = Date.now() + 6000;
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  while (Date.now() < deadline && pids.some(alive)) execSync("sleep 0.5");
  for (const pid of pids) if (alive(pid)) { try { process.kill(pid, "SIGKILL"); log("sigkilled stubborn tunnel pid", pid); } catch (e) { log("sigkill-fail", pid, e.message); } }
}
if (!killed) log("no liveapps tunnel pid to kill (run-tunnel.sh may already be reconnecting)");
// Only cooldown when we actually SIGKILL'd — otherwise we just delay an already-reconnecting run-tunnel.
if (killed) {
  try {
    const cool = +(process.env.TUNNEL_COOLDOWN_S || 45);
    fs.writeFileSync(HERE + "tunnel-cooldown.until", String(Math.floor(Date.now() / 1000) + cool));
    log("cooldown", cool, "s written for run-tunnel.sh");
  } catch (e) { log("cooldown-write-fail", e.message); }
}
writeFails(0); // reset so we don't thrash; next probe cycle decides
process.exit(0);
