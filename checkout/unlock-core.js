// Hexbox preimage-unlock core. Plain script, WebCrypto only, no network.
// Runs in a browser (inlined into unlock-*.html) and in Node 20 (tests, via vm).
// Scheme hxp1:
//   K        = 32-byte content key (random, once per product)
//   blob     = "HXP1" || nonce(12) || AES-256-GCM(K, nonce, file, aad="HXP1")
//   kdf(p)   = SHA-256("hexbox-key-v1" || preimage)      (NOT sha256(p): that's the public payment_hash)
//   wrap_i   = K XOR kdf(preimage_i)                     (published per invoice, also in the invoice memo as hxw1:<hex>)
//   keycheck = first 8 bytes of SHA-256("hexbox-keycheck-v1" || K)
var HXP = (function () {
  var C = globalThis.crypto.subtle;
  var enc = new TextEncoder();
  function hex2b(h) {
    h = String(h).trim().toLowerCase().replace(/^0x/, "");
    if (!/^([0-9a-f]{2})*$/.test(h)) throw new Error("not hex");
    var o = new Uint8Array(h.length / 2);
    for (var i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16);
    return o;
  }
  function b2hex(b) { return Array.from(b, function (x) { return x.toString(16).padStart(2, "0"); }).join(""); }
  function b64dec(s) { var bin = atob(String(s).replace(/\s+/g, "")); var o = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; }
  function cat() { var n = 0, i; for (i = 0; i < arguments.length; i++) n += arguments[i].length; var o = new Uint8Array(n), k = 0; for (i = 0; i < arguments.length; i++) { o.set(arguments[i], k); k += arguments[i].length; } return o; }
  async function sha256(b) { return new Uint8Array(await C.digest("SHA-256", b)); }
  // Wallets show the preimage as hex (most) or base64 (LND REST). Accept both.
  function parsePreimage(s) {
    s = String(s || "").trim();
    if (/^(0x)?[0-9a-fA-F]{64}$/.test(s)) return hex2b(s);
    try { var b = b64dec(s.replace(/-/g, "+").replace(/_/g, "/")); if (b.length === 32) return b; } catch (e) {}
    throw new Error("preimage should be 64 hex characters");
  }
  async function kdf(pre) { return sha256(cat(enc.encode("hexbox-key-v1"), pre)); }
  async function unwrap(wrapHex, pre) { var w = hex2b(wrapHex), d = await kdf(pre); if (w.length !== 32) throw new Error("wrap must be 32 bytes"); var k = new Uint8Array(32); for (var i = 0; i < 32; i++) k[i] = w[i] ^ d[i]; return k; }
  async function keycheck(k) { return b2hex((await sha256(cat(enc.encode("hexbox-keycheck-v1"), k))).slice(0, 8)); }
  async function decrypt(k, blob) {
    if (String.fromCharCode(blob[0], blob[1], blob[2], blob[3]) !== "HXP1") throw new Error("not an HXP1 file");
    var key = await C.importKey("raw", k, "AES-GCM", false, ["decrypt"]);
    return new Uint8Array(await C.decrypt({ name: "AES-GCM", iv: blob.slice(4, 16), additionalData: blob.slice(0, 4) }, key, blob.slice(16)));
  }
  // Minimal BOLT11 reader: payment hash (p) and memo (d). Signature is not checked;
  // sha256(preimage) == payment_hash is the check that matters here.
  function bolt11(inv) {
    var CH = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
    inv = String(inv || "").trim().toLowerCase().replace(/^lightning:/, "");
    var sep = inv.lastIndexOf("1"); if (sep < 0 || !/^ln/.test(inv)) throw new Error("not a lightning invoice");
    var w = []; for (var i = sep + 1; i < inv.length; i++) { var v = CH.indexOf(inv[i]); if (v < 0) throw new Error("bad bech32"); w.push(v); }
    w = w.slice(0, w.length - 6 - 104); // drop checksum, signature
    function to8(ws) { var acc = 0, bits = 0, o = []; for (var j = 0; j < ws.length; j++) { acc = (acc << 5) | ws[j]; bits += 5; while (bits >= 8) { bits -= 8; o.push((acc >> bits) & 255); } } return new Uint8Array(o); }
    var p = 7, out = {};
    while (p + 3 <= w.length) {
      var t = w[p], len = w[p + 1] * 32 + w[p + 2], data = w.slice(p + 3, p + 3 + len); p += 3 + len;
      if (t === 1 && len === 52) out.paymentHash = b2hex(to8(data).slice(0, 32));
      if (t === 13) out.memo = new TextDecoder().decode(to8(data));
    }
    return out;
  }
  function wrapFromText(s) { var m = /hxw1:([0-9a-fA-F]{64})/.exec(String(s || "")); return m ? m[1].toLowerCase() : null; }
  // opts: { preimage, wrap?, invoice?, pool? [{payment_hash, wrap}], meta {keycheck}, blob Uint8Array }
  async function unlock(o) {
    var pre = parsePreimage(o.preimage), ph = b2hex(await sha256(pre)), wrap = o.wrap ? (wrapFromText(o.wrap) || String(o.wrap).trim().toLowerCase()) : null, how = "wrap given";
    if (!wrap && o.invoice) {
      var inv = bolt11(o.invoice);
      if (inv.paymentHash && inv.paymentHash !== ph) throw new Error("that preimage does not belong to that invoice (hash mismatch)");
      wrap = wrapFromText(inv.memo); how = "invoice memo";
    }
    if (!wrap && o.pool) { for (var i = 0; i < o.pool.length; i++) if (o.pool[i].payment_hash === ph) { wrap = o.pool[i].wrap; how = "built-in list"; } }
    if (!wrap) throw new Error("no unlock code for payment hash " + ph.slice(0, 12) + "... (paste the invoice too, or the hxw1: code from its memo)");
    var k = await unwrap(wrap, pre);
    if (o.meta && o.meta.keycheck && (await keycheck(k)) !== o.meta.keycheck) throw new Error("wrong key: that preimage/code pair does not open this file");
    return { bytes: await decrypt(k, o.blob), paymentHash: ph, how: how };
  }
  return { hex2b: hex2b, b2hex: b2hex, b64dec: b64dec, sha256: sha256, kdf: kdf, unwrap: unwrap, keycheck: keycheck, decrypt: decrypt, bolt11: bolt11, wrapFromText: wrapFromText, parsePreimage: parsePreimage, unlock: unlock };
})();
if (typeof module !== "undefined") module.exports = HXP;
