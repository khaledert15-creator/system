const test = require("node:test");
const assert = require("node:assert/strict");
const { hmacSha256, safeEqual, verifyMetaSignature } = require("../security/signatures");

test("verifies Meta style sha256 signatures", () => {
  const rawBody = JSON.stringify({ entry: [{ id: "page-1" }] });
  const secret = "test-secret";
  const signature = `sha256=${hmacSha256(secret, rawBody)}`;
  assert.equal(verifyMetaSignature({ appSecret: secret, rawBody, signature, production: true }), true);
  assert.equal(verifyMetaSignature({ appSecret: secret, rawBody, signature: "sha256=bad", production: true }), false);
});

test("safeEqual rejects different length values without throwing", () => {
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("abc", "abc"), true);
});
