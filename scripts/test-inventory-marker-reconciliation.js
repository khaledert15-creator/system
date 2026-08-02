#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const Marker = require("../app/inventory-marker-reconciliation.js");
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const valid = () => ({
  books:[{ id:"B001", stock:3 }, { id:"B002", stock:0 }],
  inventoryBatches:[{ id:"BAT-1", productId:"B001", receivedQty:5, remainingQty:3 }],
  customers:[{ id:"C1" }], orders:[{ id:"O1" }]
});

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error.message}`); process.exitCode = 1; }
}

test("Marker exists => NO ACTION REQUIRED", () => {
  const db = valid(); db.meta = { inventoryBatchMigration:{ version:1 } };
  const preview = Marker.markerOnlyPreview(db, { operationKey:"QA-1" });
  assert.strictEqual(preview.status, "NO_ACTION_REQUIRED");
  assert.strictEqual(preview.executable, false);
});

test("Marker missing with valid batches => MARKER-ONLY preview", () => {
  const preview = Marker.markerOnlyPreview(valid(), { operationKey:"QA-2", performedAt:"2026-08-02T00:00:00.000Z" });
  assert.strictEqual(preview.status, "MARKER-ONLY RECONCILIATION");
  assert.deepStrictEqual(preview.changes, [{ operation:"add", path:"meta.inventoryBatchMigration" }]);
});

test("Marker-only changes exactly one path", () => {
  const db = valid(), before = hash(db);
  const result = Marker.applyMarkerOnly(db, { operationKey:"QA-3", performedAt:"2026-08-02T00:00:00.000Z" });
  assert.notStrictEqual(hash(result.db), before);
  const copy = JSON.parse(JSON.stringify(result.db)); delete copy.meta.inventoryBatchMigration; delete copy.meta;
  assert.deepStrictEqual(copy, db);
  assert.strictEqual(result.db.meta.inventoryBatchMigration.openingBatchesCreated, 0);
});

test("Marker-only is idempotent", () => {
  const once = Marker.applyMarkerOnly(valid(), { operationKey:"QA-IDEM", performedAt:"2026-08-02T00:00:00.000Z" });
  const onceHash = hash(once.db);
  const twice = Marker.applyMarkerOnly(once.db, { operationKey:"QA-IDEM", performedAt:"2026-08-03T00:00:00.000Z" });
  assert.strictEqual(twice.idempotent, true);
  assert.strictEqual(hash(twice.db), onceHash);
});

test("Batch mismatch blocks marker-only", () => {
  const db = valid(); db.books[0].stock = 4;
  assert.throws(() => Marker.applyMarkerOnly(db, { operationKey:"QA-MISMATCH" }), error => error.code === "BATCH_RECONCILIATION_BLOCKED");
});

test("Duplicate batch blocks marker-only", () => {
  const db = valid(); db.inventoryBatches.push({ id:"BAT-1", productId:"B001", remainingQty:0 });
  const preview = Marker.markerOnlyPreview(db, { operationKey:"QA-DUP" });
  assert.strictEqual(preview.status, "BLOCKED");
  assert.strictEqual(preview.report.duplicateBatches.length, 1);
});

test("Orphan batch blocks marker-only", () => {
  const db = valid(); db.inventoryBatches.push({ id:"BAT-X", productId:"MISSING", remainingQty:0 });
  const preview = Marker.markerOnlyPreview(db, { operationKey:"QA-ORPHAN" });
  assert.strictEqual(preview.status, "BLOCKED");
  assert.strictEqual(preview.report.orphanBatches.length, 1);
});

test("Module inspection never mutates or starts migration", () => {
  const db = valid(), before = hash(db);
  Marker.inspect(db); Marker.markerOnlyPreview(db, { operationKey:"QA-NO-STARTUP" });
  assert.strictEqual(hash(db), before);
  assert.strictEqual(db.meta, undefined);
});

console.log(`${passed}/8 inventory marker reconciliation tests passed`);
