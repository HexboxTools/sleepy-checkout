// Seller-side crypto (node:crypto). Independent of unlock-core.js on purpose, so tests cross-check two implementations.
import crypto from "node:crypto";
export const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n; // secp256k1 order: Spark splits the preimage mod n
export const sha256 = (...b) => { const h = crypto.createHash("sha256"); for (const x of b) h.update(x); return h.digest(); };
export function newPreimage() {
  // Same range the SDK uses (1..n-1), by rejection rather than modulo.
  for (;;) { const p = crypto.randomBytes(32); const v = BigInt("0x" + p.toString("hex")); if (v > 0n && v < N) return p; }
}
export const kdf = pre => sha256(Buffer.from("hexbox-key-v1"), pre);
export const xor32 = (a, b) => Buffer.from(a.map((x, i) => x ^ b[i]));
export const makeWrap = (K, pre) => xor32(K, kdf(pre)).toString("hex");
export const keycheck = K => sha256(Buffer.from("hexbox-keycheck-v1"), K).subarray(0, 8).toString("hex");
export function seal(K, plain) {
  const magic = Buffer.from("HXP1"), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", K, iv); c.setAAD(magic);
  return Buffer.concat([magic, iv, c.update(plain), c.final(), c.getAuthTag()]);
}
export function open(K, blob) {
  const magic = blob.subarray(0, 4); if (magic.toString() !== "HXP1") throw new Error("not HXP1");
  const d = crypto.createDecipheriv("aes-256-gcm", K, blob.subarray(4, 16)); d.setAAD(magic); d.setAuthTag(blob.subarray(-16));
  return Buffer.concat([d.update(blob.subarray(16, -16)), d.final()]);
}
export const memoFor = (title, wrap) => `${title} | the preimage opens the file | hxw1:${wrap}`;
