// Oct 17 R44: builds the 1200x630 link-preview card for /traction (og:image) from the REAL saved example in
// traction-sample.json. Every number on the card is read from that file. Run once: node make-card.mjs
// -> traction-card.svg + traction-card.png (rendered with headless google-chrome). Served by GET /traction/card.png.
import fs from "fs"; import path from "path"; import { execFileSync } from "child_process"; import { fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const s = JSON.parse(fs.readFileSync(path.join(HERE, "traction-sample.json"), "utf8"));
const r = s.report, so = r.scoredOn, PRICE = 21;
for (const k of ["hnPoints", "reddit30d", "githubStars"]) if (typeof so[k] !== "number") throw new Error("sample missing " + k);
const esc = v => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const n = v => Number(v).toLocaleString("en-US");
const at = new Date(s.checkedAt); const day = at.toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const target = r.query.linkKey || r.query.input;
const F = "IBM Plex Sans, DejaVu Sans, sans-serif";
const rows = [[n(so.hnPoints), "Hacker News points"], [n(so.githubStars), "GitHub stars"], [n(so.reddit30d), "Reddit posts linking it, 30 days"]];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#f6f4ef"/>
<rect x="0" y="0" width="1200" height="10" fill="#2f5d50"/>
<text x="64" y="92" font-family="${F}" font-size="26" font-weight="600" fill="#2f5d50">Hexbox Tools</text>
<text font-family="${F}" font-size="58" font-weight="700" fill="#1d1d1b"><tspan x="64" y="190">Did anyone</tspan><tspan x="64" y="258">outside HN</tspan><tspan x="64" y="326">notice your launch?</tspan></text>
<text font-family="${F}" font-size="25" fill="#6b6b66"><tspan x="64" y="400">Hacker News, Reddit, GitHub and npm</tspan><tspan x="64" y="436">for one name or link, in one result.</tspan></text>
<text x="64" y="520" font-family="${F}" font-size="32" font-weight="600" fill="#1d1d1b">${PRICE} sats, any Lightning wallet</text>
<text x="64" y="574" font-family="${F}" font-size="22" fill="#6b6b66">hexbox-3d.liveapps.dev/traction</text>
<rect x="690" y="60" width="450" height="510" rx="14" fill="#ffffff" stroke="#d9d6cf" stroke-width="2"/>
<text x="722" y="108" font-family="${F}" font-size="18" font-weight="700" letter-spacing="2" fill="#9a3b12">EXAMPLE</text>
<text x="722" y="136" font-family="${F}" font-size="18" fill="#6b6b66">A real check, saved ${esc(day)}</text>
<text x="722" y="172" font-family="${F}" font-size="20" font-weight="600" fill="#1d1d1b">${esc(target)}</text>
<text x="718" y="270" font-family="${F}" font-size="96" font-weight="700" fill="#2f5d50">${esc(r.tractionScore)}</text>
<text x="722" y="304" font-family="${F}" font-size="19" fill="#6b6b66">traction score out of 100</text>
${rows.map(([v, l], i) => `<line x1="722" x2="1108" y1="${336 + i * 74}" y2="${336 + i * 74}" stroke="#d9d6cf" stroke-width="2"/>
<text x="722" y="${380 + i * 74}" font-family="${F}" font-size="34" font-weight="700" fill="#1d1d1b">${esc(v)}</text>
<text x="830" y="${379 + i * 74}" font-family="${F}" font-size="19" fill="#6b6b66">${esc(l)}</text>`).join("\n")}
</svg>
`;
fs.writeFileSync(path.join(HERE, "traction-card.svg"), svg);
const htmlFile = path.join("/tmp", "traction-card.html");
fs.writeFileSync(htmlFile, `<!doctype html><html><head><style>html,body{margin:0;padding:0;width:1200px;height:630px;overflow:hidden}svg{display:block}</style></head><body>${svg}</body></html>`);
const out = path.join(HERE, "traction-card.png");
execFileSync("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=1200,630", `--screenshot=${out}`, "file://" + htmlFile], { stdio: "inherit", timeout: 60000 });
console.log("wrote", out, fs.statSync(out).size, "bytes");
