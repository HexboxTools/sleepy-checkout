// wakewatch.mjs (Oct 15, 2026). The box (VM) is paused between agent sessions, often 50+ min per hour.
// On resume, timers fire late, relay sockets are dead and the Spark auth session is stale
// (l402 saw DEADLINE_EXCEEDED x3 at 04:24Z). This notices the wall-clock jump and exits so the
// run-*.sh loop restarts the service clean (fresh Spark session, fresh relay pool, startup backfill).
// startWakeWatch({ log, tickMs=15000, gapMs=120000, exitCode=6, onWake })
//   gap = time since the last tick minus tickMs; if gap > gapMs -> log("wake-detected <s>s"), onWake(gap) or process.exit.
// Env overrides (tests): WAKE_TICK_MS, WAKE_GAP_MS.
export function startWakeWatch(o = {}) {
  const log = o.log || ((...a) => console.error(new Date().toISOString(), ...a));
  const tickMs = +(process.env.WAKE_TICK_MS || o.tickMs || 15000);
  const gapMs = +(process.env.WAKE_GAP_MS || o.gapMs || 120000);
  const exitCode = o.exitCode ?? 6;
  let last = Date.now(), fired = false;
  const t = setInterval(() => {
    const now = Date.now(), gap = now - last - tickMs; last = now;
    if (gap > gapMs && !fired) {
      fired = true;
      try { log(`wake-detected ${Math.round(gap / 1000)}s, exiting for restart`); } catch {}
      if (o.onWake) o.onWake(gap); else setTimeout(() => process.exit(exitCode), 200);
    }
  }, tickMs);
  if (o.unref !== false) t.unref();
  return () => clearInterval(t);
}
