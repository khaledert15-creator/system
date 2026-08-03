"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const AuditIds = require("../app/audit-id.js");

const ids = Array.from({ length:10_000 }, () => AuditIds.generateAuditId());
assert(ids.every(id => typeof id === "string" && /^AUD-[0-9a-f-]{36}$/i.test(id)));
assert(ids.every(id => !/^AUD-\d+(?:\.\d+)?e[+-]\d+$/i.test(id)));
assert.strictEqual(new Set(ids).size, ids.length);

const records = [];
for (let index = 0; index < 2_000; index += 1) AuditIds.appendAuditRecord(records, { index });
assert.strictEqual(new Set(records.map(row => row.id)).size, records.length);

let calls = 0;
const regenerated = AuditIds.assignUniqueAuditId([{ id:"AUD-existing" }], {}, { generate:() => ++calls === 1 ? "AUD-existing" : "AUD-new" });
assert.strictEqual(regenerated.id, "AUD-new");
assert.strictEqual(calls, 2);

assert.throws(() => AuditIds.appendAuditRecord([{ id:"AUD-collision" }], {}, { generate:() => "AUD-collision" }), error => error.code === "AUDIT_ID_COLLISION_BLOCKED");
const root = path.join(__dirname, "..");
for (const file of ["app/app.js", "app/factory-reset.js", "app/season-data-management.js", "server-node.js"]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  assert(source.includes("AuditIds"), `${file} must use the shared audit ID generator`);
}
assert(!/nextId\(["']AUD-/.test(fs.readFileSync(path.join(root, "app/app.js"), "utf8")));
console.log("Audit ID generation tests passed (10,000 unique IDs; retry and blocking guards verified).");
