const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizePhone, phoneSearchVariants } = require("../utils/phone");

test("normalizes Egyptian mobile numbers for matching contacts", () => {
  assert.equal(normalizePhone(" 0100 000 0001 "), "+201000000001");
  assert.equal(normalizePhone("201000000001"), "+201000000001");
  assert.equal(normalizePhone("00201000000001"), "+201000000001");
});

test("creates useful phone search variants", () => {
  const variants = phoneSearchVariants("+201000000001");
  assert.ok(variants.includes("+201000000001"));
  assert.ok(variants.includes("201000000001"));
  assert.ok(variants.includes("01000000001"));
});
