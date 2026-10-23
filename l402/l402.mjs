// L402 core: aperture-style macaroon (v2 binary, id = u16 version 0 | payment_hash 32 | token_id 32),
// challenge header, and Authorization verification (sha256(preimage) == payment_hash).
import crypto from "crypto";
import fs from "fs";
import { newMacaroon, importMacaroon } from "macaroon";
import { createRequire } from "module";
const require = createRequire("../package.json");
const bolt11 = require("light-bolt11-decoder");

export const sha256 = b => crypto.createHash("sha256").update(b).digest();

export function loadRootKey(file) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
}

export function invoiceInfo(pr) {
  const d = bolt11.decode(pr);
  const sec = n => d.sections.find(s => s.name === n)?.value;
  return { paymentHash: sec("payment_hash"), msat: +(sec("amount") || 0), expiry: d.expiry };
}

export function makeMacaroon({ rootKey, paymentHash, service, ttlSec = 3600, now = Date.now() / 1000, location = "hexbox" }) {
  const id = Buffer.concat([Buffer.from([0, 0]), Buffer.from(paymentHash, "hex"), crypto.randomBytes(32)]);
  const m = newMacaroon({ version: 2, rootKey, identifier: id, location });
  m.addFirstPartyCaveat(`services=${service}:0`);
  m.addFirstPartyCaveat(`${service}_valid_until=${Math.floor(now + ttlSec)}`);
  return Buffer.from(m.exportBinary()).toString("base64");
}

export const challengeHeaders = (mac, pr) => [`L402 macaroon="${mac}", invoice="${pr}"`, `LSAT macaroon="${mac}", invoice="${pr}"`];

// Returns {ok:true, paymentHash, tokenId} or {ok:false, error}
export function verifyAuth(header, { rootKey, service, now = Date.now() / 1000, isUsed = () => false }) {
  const m0 = String(header || "").match(/^\s*(L402|LSAT)\s+([A-Za-z0-9+/=_-]+):([0-9a-fA-F]{64})\s*$/);
  if (!m0) return { ok: false, error: "no L402 credential" };
  let mac;
  try { mac = importMacaroon(Buffer.from(m0[2].replace(/-/g, "+").replace(/_/g, "/"), "base64")); }
  catch { return { ok: false, error: "bad macaroon" }; }
  const id = Buffer.from(mac.identifier);
  if (id.length !== 66 || id.readUInt16BE(0) !== 0) return { ok: false, error: "bad macaroon id" };
  const paymentHash = id.subarray(2, 34).toString("hex"), tokenId = id.subarray(34).toString("hex");
  const pre = m0[3].toLowerCase();
  let svcOk = false;
  const check = c => {
    let x;
    // lnget / aperture clients append "preimage=<hex>" to the paid macaroon (aperture l402.Token.PaidMacaroon)
    if ((x = c.match(/^preimage=([0-9a-fA-F]{64})$/))) return x[1].toLowerCase() === pre ? null : "preimage caveat mismatch";
    if ((x = c.match(/^services=(.+)$/))) { if (x[1].split(",").some(s => s.split(":")[0] === service)) { svcOk = true; return null; } return "wrong service"; }
    if ((x = c.match(/^(.+)_valid_until=(\d+)$/))) return x[1] !== service ? "wrong service" : (+x[2] >= now ? null : "token expired");
    return "unknown caveat";
  };
  try { mac.verify(rootKey, check); } catch (e) { return { ok: false, error: /expired/.test(e.message) ? "token expired" : "macaroon rejected" }; }
  if (!svcOk) return { ok: false, error: "wrong service" };
  if (sha256(Buffer.from(pre, "hex")).toString("hex") !== paymentHash) return { ok: false, error: "preimage does not match invoice" };
  if (isUsed(paymentHash)) return { ok: false, error: "token already used" };
  return { ok: true, paymentHash, tokenId };
}
