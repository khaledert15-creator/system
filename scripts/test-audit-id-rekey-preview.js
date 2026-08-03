"use strict";

const assert = require("assert");
const { buildRekeyPreview } = require("../app/audit-id-rekey.js");

const source = { books:[{ id:"B1", stock:3 }], purchases:[{ id:"P1" }], suppliers:[{ id:"S1" }], audit:[
  { id:"AUD-DUP", operationType:"PURCHASE", entityId:"P1", result:"success" },
  { id:"AUD-DUP", operationType:"SUPPLIER", entityId:"S1", result:"success" },
  { id:"AUD-UNIQUE", operationType:"READ" }
] };
const before = JSON.stringify(source);
const preview = buildRekeyPreview(source, { dateTag:"20260803" });
assert.strictEqual(JSON.stringify(source), before);
assert.strictEqual(preview.plan.changes.length, 1);
assert.strictEqual(preview.candidate.audit[0].id, "AUD-DUP");
assert.strictEqual(preview.candidate.audit[1].id, "AUD-REKEY-20260803-0001");
assert.strictEqual(preview.validation.valid, true);
assert.strictEqual(preview.validation.semanticDiffAuditIdOnly, true);
assert.strictEqual(preview.validation.businessDataUnchanged, true);
console.log("Audit ID re-key preview tests passed (audit IDs only; business data unchanged).");
