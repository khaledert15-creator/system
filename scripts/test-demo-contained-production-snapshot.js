#!/usr/bin/env node
"use strict";

// Despite the legacy filename, the default mode deliberately tests isolated fixtures.
// A real fixed Production snapshot is checked only when --snapshot <path> is explicit.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const assert = require("assert");
const Season = require("../app/season-data-management.js");
const Marker = require("../app/inventory-marker-reconciliation.js");

const sha = value => crypto.createHash("sha256").update(value).digest("hex");

function approvedProductionLikeFixture() {
  return {
    settings:{ companyName:"QA Fixture", permissions:{ roles:{}, users:{} } },
    books:[
      { id:"B001", name:"Demo 1", stock:3, reservedStock:0 },
      { id:"B002", name:"Demo 2", stock:0, reservedStock:0 },
      { id:"B003", name:"Demo 3", stock:1, reservedStock:0 },
      { id:"B004", name:"Demo 4", stock:-1, reservedStock:0 },
      { id:"B005", name:"Demo 5", stock:2, reservedStock:0 },
      { id:"REAL-1", name:"Real", stock:7, reservedStock:0 }
    ],
    customers:[{ id:"C1", name:"Preserved Customer" }], suppliers:[{ id:"S1" }],
    users:[{ id:"U1", username:"owner" }], roles:[{ id:"R1" }],
    shippingCompanies:[{ id:"SC1" }], governorates:[{ id:"G1" }],
    shippingPrices:[{ id:"SP1" }], expenseTypes:[{ id:"E1" }], incomeTypes:[{ id:"I1" }],
    cashAccounts:[{ id:"CA1" }],
    onlineOrders:[{ id:"ORD-002", status:"تم التسليم", lines:[{ bookId:"B004", qty:1 }], saleId:"INV-1050", shipmentId:"SH-210" }],
    sales:[{ id:"INV-1050", onlineOrderId:"ORD-002", lines:[{ bookId:"B004", qty:1 }], total:150 }],
    purchases:[], returns:[],
    shipments:[
      { id:"SH-210", onlineOrderId:"ORD-002", invoiceId:"INV-1050", trackingNumber:"TR-DEMO", status:"تم التسليم" },
      { id:"SH-207", orderId:"INV-1043", invoiceId:"INV-1043", onlineOrderId:"", customerId:"", customerName:"محمد علي", phone:"", carrier:"Mylerz", tracking:"MY-551209", status:"تم التسليم", cost:65, trackingEnabled:false }
    ],
    orderPayments:[{ id:"PAY-DEMO", orderId:"ORD-002", invoiceId:"INV-1050", amount:50, status:"confirmed" }],
    orderCollections:[], cash:[{ id:"CASH-DEMO", orderId:"ORD-002", paymentId:"PAY-DEMO", amount:50, type:"قبض" }],
    stockMovements:[{ id:"MOV-003", bookId:"B004", documentId:"INV-1050", quantity:-1, before:0, after:-1 }],
    inventoryBatches:[
      { id:"OB-B001", productId:"B001", remainingQty:3 },
      { id:"OB-B003", productId:"B003", remainingQty:1 },
      { id:"OB-B005", productId:"B005", remainingQty:2 },
      { id:"REAL-BATCH", productId:"REAL-1", remainingQty:7 }
    ],
    complaints:[{ id:"CMP-DEMO", shipmentId:"SH-210" }], notifications:[{ id:"NOT-DEMO", shipmentId:"SH-210" }],
    trackingHistory:[{ id:"TH-DEMO", shipmentId:"SH-210", trackingNumber:"TR-DEMO" }],
    trackingRuns:[{ id:"TRUN-DEMO", shipmentId:"SH-210", trackingNumber:"TR-DEMO" }],
    carrierSettlements:[], expenses:[], audit:[{ id:"AUD-DEMO", entityId:"ORD-002" }]
  };
}

function negativeChangedFingerprintFixture() {
  const db = approvedProductionLikeFixture();
  db.books.find(item => item.id === "B004").stock = 2;
  db.inventoryBatches.push(
    { id:"STALE-B004-1", productId:"B004", remainingQty:1 },
    { id:"STALE-B004-2", productId:"B004", remainingQty:1 }
  );
  db.stockMovements.push({ id:"STALE-MOV-B004", bookId:"B004", documentId:"PUR-STALE", quantity:1, before:0, after:1 });
  db.purchases.push({ id:"PUR-STALE", lines:[{ bookId:"B004", qty:1 }] });
  return db;
}

function backupRequest(operationKey) {
  return { confirmation:"حذف البيانات التجريبية", operationKey, performedBy:"Isolated QA", performedAt:"2026-08-02T13:00:00.000Z", backup:{ valid:true, sourceSize:1, backupSize:1, sourceSha256:"fixture", backupSha256:"fixture", reference:"isolated-fixture" } };
}

function runNegativeFixture() {
  const preview = Season.buildDemoPreview(negativeChangedFingerprintFixture());
  assert.strictEqual(preview.inventoryExceptions[0].accepted, false);
  assert.strictEqual(preview.inventoryExceptions[0].status, "BLOCKED");
  assert.strictEqual(preview.executable, false);
  assert.strictEqual(preview.deploymentReadiness.codeDeploymentAllowed, false);
  assert.ok(preview.inventoryExceptions[0].reasons.some(reason => reason.includes("B004 stock")));
  assert.ok(preview.inventoryExceptions[0].reasons.some(reason => reason.includes("B004 مرتبط بمشتريات")));
  assert.throws(() => Season.purgeDemoDataset(negativeChangedFingerprintFixture(), backupRequest("NEGATIVE-FIXTURE")));
  console.log("PASS Test A — changed/stale B004 fixture is BLOCKED by the guard");
}

function runApprovedFixture() {
  const db = approvedProductionLikeFixture();
  const before = sha(Buffer.from(JSON.stringify(db)));
  const preview = Season.buildDemoPreview(db);
  assert.strictEqual(preview.inventoryExceptions[0].accepted, true);
  assert.strictEqual(preview.inventoryExceptions[0].code, "DEMO_CONTAINED_INVENTORY_EXCEPTION");
  assert.strictEqual(preview.explicitSeedRecords[0].accepted, true);
  assert.strictEqual(preview.explicitSeedRecords[0].code, "EXPLICIT_APPROVED_SEED_RECORD");
  assert.strictEqual(preview.scope.shipments.includes("SH-207"), true);
  assert.strictEqual(preview.executable, true);
  assert.strictEqual(sha(Buffer.from(JSON.stringify(db))), before, "Fixture preview mutated its source");

  const purged = Season.purgeDemoDataset(db, backupRequest("APPROVED-PRODUCTION-LIKE-FIXTURE"));
  assert.strictEqual(purged.postPurgeInventoryResult.valid, true);
  assert.ok(Object.values(purged.orphans).every(rows => rows.length === 0));
  assert.strictEqual(purged.db.shipments.some(item => item.id === "SH-207"), false);
  assert.strictEqual(purged.postPurgeFinanceResult.valid, true);
  const markerPreview = Marker.markerOnlyPreview(purged.db, { operationKey:"MARKER-PREVIEW-FIXTURE" });
  assert.strictEqual(markerPreview.status, "MARKER-ONLY RECONCILIATION");
  console.log("PASS Test B — approved Production-like fixture previews, purges, reconciles, and reaches MARKER-ONLY");
}

function runExplicitSnapshot(snapshotPath) {
  const absolute = path.resolve(snapshotPath);
  const source = fs.readFileSync(absolute);
  const db = JSON.parse(source);
  const preview = Season.buildDemoPreview(db);
  assert.strictEqual(preview.inventoryExceptions[0]?.accepted, true, JSON.stringify(preview.inventoryExceptions[0]?.reasons || []));
  assert.strictEqual(preview.explicitSeedRecords[0]?.accepted, true, JSON.stringify(preview.explicitSeedRecords[0]?.reasons || []));
  assert.strictEqual(preview.deploymentReadiness.codeDeploymentAllowed, true);
  assert.strictEqual(sha(fs.readFileSync(absolute)), sha(source), "Read-only snapshot check changed source SHA");
  console.log(`PASS Test C — explicit fixed snapshot verified read-only (${source.length} bytes, sha256 ${sha(source)})`);
}

const snapshotFlag = process.argv.indexOf("--snapshot");
if (snapshotFlag >= 0) {
  assert.ok(process.argv[snapshotFlag + 1], "--snapshot requires an explicit fixed snapshot path");
  runExplicitSnapshot(process.argv[snapshotFlag + 1]);
} else {
  console.log("MODE=ISOLATED_FIXTURES (not a Production snapshot)");
  runNegativeFixture();
  runApprovedFixture();
  console.log("2/2 demo-contained fixture suites passed");
}
