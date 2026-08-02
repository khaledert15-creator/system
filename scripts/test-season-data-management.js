#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const SeasonData = require("../app/season-data-management.js");

const sha = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fixture = () => ({
  settings:{ companyName:"QA", permissions:{ roles:{}, users:{} } },
  books:[
    { id:"B001", name:"Demo 1", stock:3 }, { id:"B002", name:"Demo 2", stock:0 },
    { id:"B003", name:"Demo 3", stock:1 }, { id:"B004", name:"Demo 4", stock:-1 }, { id:"B005", name:"Demo 5", stock:2 },
    { id:"REAL-1", name:"Real", stock:7 }
  ],
  customers:[{ id:"C1", name:"Preserved Customer" }], suppliers:[{ id:"S1" }], users:[{ id:"U1", username:"owner" }],
  shippingCompanies:[{ id:"SC1" }], governorates:[{ id:"G1" }], expenseTypes:[{ id:"E1" }], incomeTypes:[{ id:"I1" }], cashAccounts:[{ id:"CA1" }],
  onlineOrders:[{ id:"ORD-DEMO", status:"تم التسليم", lines:[{ bookId:"B004", qty:1 }], saleId:"INV-DEMO", shipmentId:"SH-DEMO" }],
  sales:[{ id:"INV-DEMO", onlineOrderId:"ORD-DEMO", lines:[{ bookId:"B004", qty:1 }], total:150 }],
  purchases:[], returns:[],
  shipments:[{ id:"SH-DEMO", onlineOrderId:"ORD-DEMO", invoiceId:"INV-DEMO", trackingNumber:"TR-DEMO", status:"تم التسليم" }],
  orderPayments:[{ id:"PAY-DEMO", orderId:"ORD-DEMO", invoiceId:"INV-DEMO", amount:50, status:"confirmed" }],
  orderCollections:[{ id:"COL-DEMO", orderId:"ORD-DEMO", shipmentId:"SH-DEMO", amount:100, status:"settled" }],
  cash:[{ id:"CASH-DEMO", orderId:"ORD-DEMO", paymentId:"PAY-DEMO", amount:50, type:"قبض" }],
  stockMovements:[{ id:"MOV-DEMO", bookId:"B004", documentId:"INV-DEMO", quantity:-1, before:0, after:-1 }],
  inventoryBatches:[], complaints:[{ id:"CMP-DEMO", shipmentId:"SH-DEMO" }],
  notifications:[{ id:"NOT-DEMO", shipmentId:"SH-DEMO" }], trackingHistory:[{ id:"TH-DEMO", shipmentId:"SH-DEMO", trackingNumber:"TR-DEMO" }],
  trackingRuns:[{ id:"TRUN-DEMO", shipmentId:"SH-DEMO", trackingNumber:"TR-DEMO" }],
  audit:[{ id:"AUD-SAME", entityId:"ORD-DEMO" }, { id:"AUD-SAME", entityId:"REAL-1" }]
});

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("Dry Run يعرض العلاقات دون تغيير SHA", () => {
  const db = fixture(), before = sha(db), preview = SeasonData.buildDemoPreview(db);
  assert.strictEqual(preview.counts.books, 5);
  assert.strictEqual(preview.counts.onlineOrders, 1);
  assert.strictEqual(preview.counts.sales, 1);
  assert.strictEqual(preview.counts.shipments, 1);
  assert.strictEqual(preview.counts.stockMovements, 1);
  assert.strictEqual(preview.counts.audit, 1);
  assert.strictEqual(preview.blockedRecords.length, 0);
  assert.strictEqual(sha(db), before);
});

test("Purge مترابط داخل Fixture ويحافظ على السجلات الحقيقية", () => {
  const db = fixture();
  const result = SeasonData.purgeDemoDataset(db, { confirmation:"حذف البيانات التجريبية", operationKey:"QA-1", performedBy:"QA Owner", backup:{ valid:true, sourceSize:100, backupSize:100, sourceSha256:"same", backupSha256:"same", reference:"qa/backup" } });
  assert.deepStrictEqual(result.db.books.map(item => item.id), ["REAL-1"]);
  assert.strictEqual(result.db.onlineOrders.length, 0);
  assert.strictEqual(result.db.sales.length, 0);
  assert.strictEqual(result.db.shipments.length, 0);
  assert.strictEqual(result.db.stockMovements.length, 0);
  assert.strictEqual(result.db.audit.some(item => item.entityId === "REAL-1"), true);
  assert.strictEqual(result.db.customers.length, 1);
  assert.strictEqual(Object.values(SeasonData.orphanReport(result.db)).flat().length, 0);
});

test("Purge Idempotent بنفس Operation Key", () => {
  const db = fixture(), request = { confirmation:"حذف البيانات التجريبية", operationKey:"QA-IDEMPOTENT", performedBy:"QA Owner", backup:{ valid:true, sourceSize:1, backupSize:1, sourceSha256:"x", backupSha256:"x", reference:"qa" } };
  const once = SeasonData.purgeDemoDataset(db, request);
  const twice = SeasonData.purgeDemoDataset(once.db, request);
  assert.strictEqual(twice.idempotent, true);
  assert.strictEqual(twice.db.audit.filter(item => item.operationKey === request.operationKey).length, 1);
});

test("Real Record Protection يمنع السجل المختلط", () => {
  const db = fixture();
  db.onlineOrders.push({ id:"ORD-MIXED", status:"جديد", lines:[{ bookId:"B001", qty:1 }, { bookId:"REAL-1", qty:1 }] });
  const preview = SeasonData.buildDemoPreview(db);
  assert.strictEqual(preview.executable, false);
  assert.strictEqual(preview.blockedRecords.some(item => item.id === "ORD-MIXED"), true);
  assert.throws(() => SeasonData.purgeDemoDataset(db, { confirmation:"حذف البيانات التجريبية", operationKey:"QA-2", performedBy:"QA", backup:{ valid:true, sourceSize:1, backupSize:1, sourceSha256:"x", backupSha256:"x", reference:"qa" } }), error => error.code === "MIXED_RECORDS_BLOCKED");
});

test("Backup Guard إلزامي", () => {
  assert.throws(() => SeasonData.purgeDemoDataset(fixture(), { confirmation:"حذف البيانات التجريبية", operationKey:"QA-3", performedBy:"QA" }), error => error.code === "BACKUP_GUARD_FAILED");
});

test("Season Creation يسمح بموسم Active واحد", () => {
  const created = SeasonData.createSeason(fixture(), { id:"SEA-2627", name:"موسم المدارس", academicYear:"2026/2027", startsAt:"2026-08-01" }, { name:"Owner" });
  assert.strictEqual(created.season.status, "active");
  assert.strictEqual(created.db.settings.activeSeasonId, "SEA-2627");
  assert.throws(() => SeasonData.createSeason(created.db, { name:"آخر", academicYear:"2027/2028", startsAt:"2027-08-01" }, { name:"Owner" }), error => error.code === "ACTIVE_SEASON_EXISTS");
});

test("Close Season يمنع الإغلاق مع عمليات مفتوحة", () => {
  let db = fixture();
  db.onlineOrders[0].status = "قيد التجهيز";
  db = SeasonData.createSeason(db, { id:"SEA-OPEN", name:"Active", academicYear:"2026/2027", startsAt:"2026-08-01" }, { name:"Owner" }).db;
  db.onlineOrders[0].seasonId = "SEA-OPEN";
  assert.throws(() => SeasonData.closeSeason(db, "SEA-OPEN", {}, { name:"Owner" }), error => error.code === "OPEN_OPERATIONS");
  const closed = SeasonData.closeSeason(db, "SEA-OPEN", { administrativeOverride:true, reason:"QA approved" }, { name:"Owner" });
  assert.strictEqual(closed.season.status, "closed");
});

test("Legacy Operations لا تمنع إغلاق موسم جديد", () => {
  let db = fixture();
  db.onlineOrders[0].status = "قيد التجهيز";
  db = SeasonData.createSeason(db, { id:"SEA-NEW", name:"New", academicYear:"2026/2027", startsAt:"2026-08-01" }, { name:"Owner" }).db;
  const closed = SeasonData.closeSeason(db, "SEA-NEW", {}, { name:"Owner" });
  assert.strictEqual(closed.season.status, "closed");
});

test("New Inventory يبدأ صفر عند اختيار قالب كتاب", () => {
  const db = fixture();
  const season = SeasonData.createSeason(db, { id:"SEA-ZERO", name:"New", academicYear:"2026/2027", startsAt:"2026-08-01", preserve:{ bookTemplates:true } }, { name:"Owner" }).db;
  season.books.push({ id:"NEW-SEASON-BOOK", templateOf:"REAL-1", name:"Real", stock:0 });
  SeasonData.linkNewRecordsToActiveSeason(db, season);
  const book = season.books.find(item => item.id === "NEW-SEASON-BOOK");
  assert.strictEqual(book.stock, 0);
  assert.strictEqual(book.seasonId, "SEA-ZERO");
});

test("Lazy Persistence لا يضيف Seasons أو seasonId عند القراءة", () => {
  const db = fixture(), before = sha(db), runtime = SeasonData.runtimeSeasons(db);
  assert.strictEqual(runtime[0].runtimeOnly, true);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(db, "seasons"), false);
  assert.strictEqual(db.books.some(item => Object.prototype.hasOwnProperty.call(item, "seasonId")), false);
  assert.strictEqual(sha(db), before);
});

(async () => {
  let passed = 0;
  for (const item of tests) {
    try { await item.fn(); passed += 1; console.log(`PASS ${item.name}`); }
    catch (error) { console.error(`FAIL ${item.name}: ${error.stack || error.message}`); process.exitCode = 1; }
  }
  console.log(`${passed}/${tests.length} season data management tests passed`);
})();
