const crypto = require("crypto");

function hmacSha256(secret, rawBody) {
  return crypto.createHmac("sha256", secret || "").update(rawBody || "").digest("hex");
}

function safeEqual(a = "", b = "") {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyMetaSignature({ appSecret, rawBody, signature, required = false }) {
  if (!required && !signature) return true;
  if (!appSecret || !signature) return false;
  const expected = `sha256=${hmacSha256(appSecret, rawBody)}`;
  return safeEqual(expected, signature);
}

module.exports = { hmacSha256, safeEqual, verifyMetaSignature };
