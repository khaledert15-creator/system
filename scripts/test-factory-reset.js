#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const FactoryReset = require("../app/factory-reset.js");

const sha = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const backup = { valid:true, sourceSize:128, backupSize:128, sourceSha256:"same", backupSha256:"same", reference:"qa/pre-reset", manifestValid:true };
const fixture = () => ({
  version:4,
  settings:{ companyName:"QA Store", currency:"ج.م", permissions:{ roles:{ مالك:{ actions:["factory_reset_system"] } }, users:{ owner:{ actions:["factory_reset_system"] }, cashier:{ actions:["new-sale-invoice"] } } }, integrations:{ tracking:{ enabled:true } } },
  integrations:{ tracking:{ endpoint:"private-config" } }, messageTemplates:[{ id:"MT1" }], governorates:[{ id:"G1", name:"القاهرة", price:70 }],
  shippingCompanies:[{ id:"SC1" }], cashAccounts:[{ id:"CA1" }], expenseTypes:[{ id:"ET1" }], incomeTypes:[{ id:"IT1" }],
  users:[
    { id:"U1", username:"owner", name:"QA Owner", role:"مالك", salt:"s", passwordHash:"hash", active:true },
    { id:"U2", username:"cashier", name:"Cashier", role:"كاشير", salt:"s2", passwordHash:"hash2", active:true }
  ], employees:[{ id:"E1", username:"owner", role:"مالك" },{ id:"E2", username:"cashier", role:"كاشير" }],
  customers:[{ id:"C1" }], suppliers:[{ id:"S1" }], books:[{ id:"B1", stock:3 }], inventoryBatches:[{ id:"IB1", productId:"B1", remainingQty:3 }],
  stockMovements:[{ id:"SM1", bookId:"B1" }], reservations:[{ id:"R1", bookId:"B1" }], purchases:[{ id:"P1" }], returns:[{ id:"PR1" }],
  onlineOrders:[{ id:"O1" }], sales:[{ id:"I1" }], shipments:[{ id:"SH1", invoiceId:"I1" }], trackingHistory:[{ id:"TH1", shipmentId:"SH1" }],
  trackingRuns:[{ id:"TR1", shipmentId:"SH1" }], complaints:[{ id:"CP1", shipmentId:"SH1" }], orderPayments:[{ id:"PAY1" }], cash:[{ id:"CM1" }],
  orderCollections:[{ id:"COL1" }], carrierSettlements:[{ id:"CS1" }], expenses:[{ id:"EX1" }], otherIncome:[{ id:"OI1" }], notifications:[{ id:"N1" }],
  reportSnapshots:[{ id:"RP1" }], dayClosings:[{ id:"DC1" }], receipts:[{ id:"RC1" }], audit:[{ id:"A1", operationType:"SETTINGS_CHANGE", entity:"الإعدادات" },{ id:"A2", operationType:"ORDER_CREATED", entity:"الطلبات" }]
});
const request = (type, operationKey) => ({ resetType:type, operationKey, authorized:true, confirmationPhrase:FactoryReset.CONFIRMATION_PHRASE, currentUsername:"owner", performedByUsername:"owner", performedBy:"QA Owner", backup, performedAt:"2026-08-02T12:00:00.000Z" });
const tests=[]; const test=(name,fn)=>tests.push({name,fn});

test("Preview فقط لا يغير البيانات",()=>{const db=fixture(),before=sha(db),p=FactoryReset.preview(db,"business");assert.strictEqual(p.summary.products,1);assert.strictEqual(p.summary.financeRecords,8);assert.strictEqual(sha(db),before);});
test("Backup مطلوب قبل التنفيذ",()=>assert.throws(()=>FactoryReset.execute(fixture(),{...request("business","NO-BACKUP"),backup:null}),e=>e.code==="BACKUP_GUARD_FAILED"));
test("User بدون صلاحية BLOCKED",()=>assert.throws(()=>FactoryReset.execute(fixture(),{...request("business","NO-PERM"),authorized:false}),e=>e.code==="PERMISSION_DENIED"));
test("Wrong confirmation phrase BLOCKED",()=>assert.throws(()=>FactoryReset.execute(fixture(),{...request("business","BAD-PHRASE"),confirmationPhrase:"حذف"}),e=>e.code==="CONFIRMATION_REQUIRED"));
test("No Owner user BLOCKED",()=>{const db=fixture();db.users=db.users.filter(x=>x.username!=="owner");assert.strictEqual(FactoryReset.preview(db,"factory").executable,false);assert.throws(()=>FactoryReset.execute(db,request("factory","NO-OWNER")),e=>e.code==="OWNER_REQUIRED");});
test("Business Reset يحافظ على Users وSettings والمرجعيات",()=>{const result=FactoryReset.execute(fixture(),request("business","BUSINESS-1"));assert.strictEqual(result.db.books.length,0);assert.strictEqual(result.db.sales.length,0);assert.strictEqual(result.db.users.length,2);assert.strictEqual(result.db.customers.length,1);assert.strictEqual(result.db.suppliers.length,1);assert.strictEqual(result.db.settings.companyName,"QA Store");assert.strictEqual(result.db.shippingCompanies.length,1);assert.strictEqual(result.db.audit.some(x=>x.id==="A1"),true);assert.strictEqual(result.db.audit.some(x=>x.id==="A2"),false);assert.strictEqual(result.validation.valid,true);});
test("Factory Reset يحافظ على Owner Login والإعدادات الأساسية",()=>{const result=FactoryReset.execute(fixture(),request("factory","FACTORY-1"));assert.deepStrictEqual(result.db.users.map(x=>x.username),["owner"]);assert.strictEqual(result.db.users[0].passwordHash,"hash");assert.strictEqual(result.db.settings.companyName,"QA Store");assert.deepStrictEqual(Object.keys(result.db.settings.permissions.users),["owner"]);assert.strictEqual(result.db.books.length,0);assert.strictEqual(result.db.customers.length,0);assert.strictEqual(Array.isArray(result.db.payments),true);assert.strictEqual(result.validation.loginPossible,true);});
test("Post-reset empty state آمن بلا مخزون سالب أو Orphans",()=>{const result=FactoryReset.execute(fixture(),request("factory","EMPTY-1"));assert.strictEqual(result.validation.inventoryEmpty,true);assert.deepStrictEqual(result.validation.negativeStock,[]);assert.deepStrictEqual(result.validation.orphanShipments,[]);assert.deepStrictEqual(result.validation.orphanBatches,[]);});
test("Idempotency يمنع حذفًا أو Audit مكررًا",()=>{const once=FactoryReset.execute(fixture(),request("business","IDEMPOTENT-1"));const twice=FactoryReset.execute(once.db,{...request("business","IDEMPOTENT-1"),backup:null});assert.strictEqual(twice.idempotent,true);assert.strictEqual(twice.db.audit.filter(x=>x.operationKey==="IDEMPOTENT-1").length,1);});
test("Audit مستقل يحتوي نتيجة الحماية دون عبارة حساسة",()=>{const result=FactoryReset.execute(fixture(),request("business","AUDIT-1"));assert.strictEqual(result.audit.operationType,"BUSINESS_DATA_RESET");assert.strictEqual(result.audit.confirmationPhraseUsed,true);assert.strictEqual(JSON.stringify(result.audit).includes(FactoryReset.CONFIRMATION_PHRASE),false);assert.strictEqual(result.audit.postResetValidation.valid,true);});
test("Fixture execution لا يكتب أي ملف Production",()=>{const db=fixture(),before=sha(db);FactoryReset.execute(db,request("business","MEMORY-ONLY"));assert.strictEqual(sha(db),before);});

let passed=0;
for(const item of tests){try{item.fn();passed+=1;console.log(`PASS ${item.name}`);}catch(error){console.error(`FAIL ${item.name}: ${error.stack||error.message}`);process.exitCode=1;}}
console.log(`${passed}/${tests.length} factory reset tests passed`);
