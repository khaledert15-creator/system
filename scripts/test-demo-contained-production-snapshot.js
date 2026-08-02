#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const assert = require("assert");
const Season = require("../app/season-data-management.js");
const Marker = require("../app/inventory-marker-reconciliation.js");

const input = path.resolve(process.argv[2] || "data/database.json");
const outputDir = path.resolve(process.argv[3] || path.join(process.cwd(), "tmp-season-qa"));
const source = fs.readFileSync(input);
const db = JSON.parse(source);
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const preserveKeys = ["customers","suppliers","users","shippingCompanies","cashAccounts","roles","governorates","shippingPrices","expenseTypes","incomeTypes"];
const preservedBefore = Object.fromEntries(preserveKeys.map(key => [key, JSON.stringify(db[key])]).concat([["settings",JSON.stringify(db.settings)]]));
const preview = Season.buildDemoPreview(db);
assert.strictEqual(preview.inventoryExceptions[0].accepted, true, JSON.stringify(preview.inventoryExceptions[0].reasons));
assert.strictEqual(sha(fs.readFileSync(input)), sha(source), "Dry Run changed source SHA");

const request = { confirmation:"حذف البيانات التجريبية", operationKey:"REMOTE-QA-DEMO-PURGE-20260802", performedBy:"Remote Docker QA", performedAt:"2026-08-02T13:00:00.000Z", backup:{ valid:true, sourceSize:source.length, backupSize:source.length, sourceSha256:sha(source), backupSha256:sha(source), reference:"isolated-qa/snapshot/database.json" } };
const purged = Season.purgeDemoDataset(db, request);
const repeatedPurge = Season.purgeDemoDataset(purged.db, request);
const preserved = Object.fromEntries(Object.entries(preservedBefore).map(([key,value]) => [key, JSON.stringify(purged.db[key]) === value]));
assert.ok(Object.values(preserved).every(Boolean), `Preservation failed: ${JSON.stringify(preserved)}`);
assert.strictEqual(purged.postPurgeInventoryResult.valid, true);
assert.ok(Object.values(purged.newOrphans).every(rows => rows.length === 0));
assert.strictEqual(repeatedPurge.idempotent, true);
assert.strictEqual(repeatedPurge.db.audit.filter(x => x.operationKey === request.operationKey).length, 1);

const markerPreview = Marker.markerOnlyPreview(purged.db, { operationKey:"REMOTE-QA-MARKER-20260802", performedAt:"2026-08-02T13:01:00.000Z" });
assert.strictEqual(markerPreview.status, "MARKER-ONLY RECONCILIATION");
const marked = Marker.applyMarkerOnly(purged.db, { operationKey:"REMOTE-QA-MARKER-20260802", performedAt:"2026-08-02T13:01:00.000Z" });
const repeatedMarker = Marker.applyMarkerOnly(marked.db, { operationKey:"REMOTE-QA-MARKER-20260802", performedAt:"2026-08-02T13:02:00.000Z" });
assert.strictEqual(repeatedMarker.idempotent, true);

fs.mkdirSync(outputDir, { recursive:true });
fs.writeFileSync(path.join(outputDir, "purged-database.json"), JSON.stringify(purged.db, null, 2));
fs.writeFileSync(path.join(outputDir, "marker-only-database.json"), JSON.stringify(marked.db, null, 2));
const financeIds = new Set(["TX-0004","TX-0005","TX-0006"]);
const report = {
  source:{ size:source.length, sha256:sha(source) }, preview:{ counts:preview.counts, inventoryExceptions:preview.inventoryExceptions, blockedRecords:preview.blockedRecords },
  deletedCounts:purged.deleted, preserved, postPurgeInventoryResult:purged.postPurgeInventoryResult, orphans:purged.orphans, preExistingOrphans:purged.preExistingOrphans, newOrphans:purged.newOrphans,
  finance:{ demoCashRemaining:(purged.db.cash||[]).filter(x=>financeIds.has(x.id)).length, demoPaymentsRemaining:(purged.db.orderPayments||[]).length, carrierSettlements:(purged.db.carrierSettlements||[]).length, orderCollections:(purged.db.orderCollections||[]).length },
  audit:{ count:purged.db.audit.filter(x=>x.operationKey===request.operationKey).length, operationType:purged.audit.operationType, hasException:purged.audit.containedInventoryExceptions?.[0]?.accepted===true },
  purgeIdempotent:repeatedPurge.idempotent, markerPreview:markerPreview.status,
  markerDiff:{ onlyPath:"meta.inventoryBatchMigration", openingBatchesCreated:marked.db.meta.inventoryBatchMigration.openingBatchesCreated, purgedSha256:sha(JSON.stringify(purged.db)), markedSha256:sha(JSON.stringify(marked.db)), secondSha256:sha(JSON.stringify(repeatedMarker.db)), idempotent:repeatedMarker.idempotent, batchCountBefore:(purged.db.inventoryBatches||[]).length, batchCountAfter:(marked.db.inventoryBatches||[]).length }
};
fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
