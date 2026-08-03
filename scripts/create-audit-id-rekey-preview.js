"use strict";

const fs = require("fs");
const path = require("path");
const { buildRekeyPreview } = require("../app/audit-id-rekey.js");

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Usage: node scripts/create-audit-id-rekey-preview.js INPUT_JSON OUTPUT_DIR");
const source = JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8"));
const preview = buildRekeyPreview(source);
fs.mkdirSync(path.resolve(outputPath), { recursive:true, mode:0o700 });
const files = {
  "duplicate-audit-report.json":preview.report,
  "audit-rekey-plan.json":preview.plan,
  "audit-rekey-candidate.json":preview.candidate,
  "validation-report.json":preview.validation
};
for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(path.resolve(outputPath), name), `${JSON.stringify(value, null, 2)}\n`, { mode:0o600 });
if (!preview.validation.valid) throw Object.assign(new Error("Audit re-key candidate validation failed."), { validation:preview.validation });
console.log(JSON.stringify({ ok:true, outputPath:path.resolve(outputPath), changedAuditIds:preview.plan.changes.length, validation:preview.validation }, null, 2));
