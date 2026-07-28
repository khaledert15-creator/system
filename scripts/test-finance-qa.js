const assert = require("assert");

function toCents(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Number.EPSILON) * 100);
}

function fromCents(value) {
  return Number((Number(value || 0) / 100).toFixed(2));
}

function commission(collectionAmount, rate = 0.5, minimum = 5) {
  const baseCents = toCents(collectionAmount);
  if (baseCents < 0) throw new Error("negative collection");
  if (baseCents === 0) return 0;
  return fromCents(Math.max(Math.round(baseCents * rate / 100), toCents(minimum)));
}

function settlement(values) {
  const collection = values.reduce((sum, item) => sum + toCents(item.collection), 0);
  const shipping = values.reduce((sum, item) => sum + toCents(item.shipping), 0);
  const fees = values.reduce((sum, item) => sum + toCents(item.commission), 0);
  return fromCents(collection - shipping - fees);
}

const cases = [
  [600, 5],
  [1000, 5],
  [2000, 10],
  [1001, 5.01],
  [0, 0]
];

for (const [input, expected] of cases) {
  assert.strictEqual(commission(input), expected, `commission ${input}`);
  console.log(`PASS commission ${input} => ${expected}`);
}

assert.throws(() => commission(-1), /negative collection/);
console.log("PASS negative collection rejected");

assert.strictEqual(settlement([
  { collection: 600, shipping: 40, commission: 5 },
  { collection: 1001, shipping: 55.25, commission: 5.01 }
]), 1495.74);
console.log("PASS multi-shipment settlement uses integer cents");

assert.strictEqual(fromCents(toCents(0.1) + toCents(0.2)), 0.3);
console.log("PASS decimal addition has no floating-point residue");

function legacyExpectedCost(shipment) {
  return Number(shipment.carrierShippingCostExpected ?? shipment.cost ?? 0);
}

const legacyShipment = { id: "SH-OLD", cost: 40 };
const legacyBefore = JSON.stringify(legacyShipment);
assert.strictEqual(legacyExpectedCost(legacyShipment), 40);
assert.strictEqual(JSON.stringify(legacyShipment), legacyBefore);
assert.strictEqual(Boolean(legacyShipment.settlementId), false);
console.log("PASS legacy shipment.cost is read without mutation or auto-settlement");

const noCostShipment = { id: "SH-NO-COST" };
assert.strictEqual(legacyExpectedCost(noCostShipment), 0);
assert.ok(Number.isFinite(legacyExpectedCost(noCostShipment)));
console.log("PASS shipment without cost returns zero, never NaN");
