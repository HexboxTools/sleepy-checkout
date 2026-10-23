// Top up preimage invoice pool; exit on wake so run-rotate-watch.sh restarts clean.
import { startWakeWatch } from "../wakewatch/wakewatch.mjs";
import { spawn } from "child_process";
import fs from "fs";

const log = (...a) => {
  const line = [new Date().toISOString(), ...a].join(" ");
  console.log(line);
  try { fs.appendFileSync("./rotate-watch.log", line + "\n"); } catch {}
};

startWakeWatch({ log, gapMs: 120000, exitCode: 6 });

function run() {
  return new Promise((resolve) => {
    const p = spawn("./rotate.sh", ["render-ladder", "3"], { cwd: ".", stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", d => { out += d; process.stdout.write(d); });
    p.stderr.on("data", d => { out += d; process.stderr.write(d); });
    p.on("close", code => { log(`rotate-exit ${code}`); resolve(code); });
  });
}

await run();
// stay alive until wake-exit; tick every 10 min
setInterval(() => { run().catch(e => log("rotate-err", e.message)); }, 600000);
log("rotate-watch started");
