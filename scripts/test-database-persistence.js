#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { createDatabasePersistence } = require("../app/database-persistence.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "database-persistence-"));
const dbPath = path.join(temp, "database.json");
const sha = () => crypto.createHash("sha256").update(fs.readFileSync(dbPath)).digest("hex");
const fixture = () => ({ meta:{ dataRevision:0 }, books:[], purchases:[], suppliers:[], stockMovements:[], inventoryBatches:[], sales:[], shipments:[], settings:{}, audit:[] });
fs.writeFileSync(dbPath, `${JSON.stringify(fixture(), null, 2)}\n`);
const events=[];
const store=createDatabasePersistence({filePath:dbPath,logger:event=>events.push(event)});
let passed=0;
const test=(name,fn)=>{try{fn();passed++;console.log(`PASS ${name}`);}catch(error){console.error(`FAIL ${name}: ${error.stack||error.message}`);process.exitCode=1;}};

test("إنشاء فاتورة شراء ثم reload",()=>{const {db,revision}=store.read();db.purchases.push({id:"PUR-1"});store.write(db,{expectedRevision:revision,operationType:"PURCHASE_CREATED"});assert.strictEqual(store.read().db.purchases[0].id,"PUR-1");});
test("إنشاء مورد ثم reload",()=>{const {db,revision}=store.read();db.suppliers.push({id:"S1",name:"Supplier"});store.write(db,{expectedRevision:revision,operationType:"SUPPLIER_CREATED"});assert.strictEqual(store.read().db.suppliers[0].name,"Supplier");});
test("تعديل مورد ثم reload",()=>{const {db,revision}=store.read();db.suppliers[0].name="Updated";store.write(db,{expectedRevision:revision,operationType:"SUPPLIER_UPDATED"});assert.strictEqual(store.read().db.suppliers[0].name,"Updated");});
test("حذف المورد يحتاج mutation صريح",()=>{const before=store.read();assert.strictEqual(before.db.suppliers.length,1);before.db.suppliers[0].deletedAt="2026-08-03T00:00:00Z";store.write(before.db,{expectedRevision:before.revision,operationType:"SUPPLIER_DELETED"});assert.ok(store.read().db.suppliers[0].deletedAt);});
test("background stale write ممنوع",()=>{const stale=store.read(),fresh=store.read();fresh.db.books.push({id:"B1"});store.write(fresh.db,{expectedRevision:fresh.revision,operationType:"PRODUCT_CREATED"});stale.db.stockMovements.push({id:"OLD"});assert.throws(()=>store.write(stale.db,{expectedRevision:stale.revision,operationType:"TRACKING_CYCLE"}),e=>e.code==="DATABASE_WRITE_BLOCKED_STALE_REVISION");assert.strictEqual(store.read().db.books.length,1);});
test("عمليتا save متزامنتان لا تطمسان بعضهما",()=>{const one=store.read(),two=store.read();one.db.sales.push({id:"INV-1"});store.write(one.db,{expectedRevision:one.revision});two.db.shipments.push({id:"SH-OLD"});assert.throws(()=>store.write(two.db,{expectedRevision:two.revision}),e=>e.code==="DATABASE_WRITE_BLOCKED_STALE_REVISION");assert.deepStrictEqual(store.read().db.sales.map(x=>x.id),["INV-1"]);});
test("read لا يكتب database",()=>{const before=sha(),mtime=fs.statSync(dbPath).mtimeMs;store.read();assert.strictEqual(sha(),before);assert.strictEqual(fs.statSync(dbPath).mtimeMs,mtime);});
test("الكتابة atomic وJSON valid",()=>{JSON.parse(fs.readFileSync(dbPath));assert.strictEqual(fs.readdirSync(temp).filter(x=>x.endsWith(".tmp")).length,0);assert.ok(events.some(x=>x.operationType==="DATABASE_WRITE"));});
test("بعد server restart البيانات باقية",()=>{const restarted=createDatabasePersistence({filePath:dbPath});assert.strictEqual(restarted.read().db.purchases[0].id,"PUR-1");assert.strictEqual(restarted.read().db.suppliers[0].name,"Updated");});

const app=fs.readFileSync(path.join(__dirname,"..","app","app.js"),"utf8");
const server=fs.readFileSync(path.join(__dirname,"..","server-node.js"),"utf8");
test("Auto-save status success/fail ظاهر",()=>{assert.ok(app.includes("جارٍ حفظ البيانات...")&&app.includes("فشل الحفظ على القرص")&&app.includes("آخر حفظ"));});
test("فشل حفظ الشراء لا يعتبر نجاحًا",()=>{assert.ok(app.includes("بقيت المسودة محفوظة ولم تُعتمد الفاتورة")&&app.includes("const saved = await saveData(\"PURCHASE_CREATED\""));});
test("Draft protection وتحذير المغادرة موجودان",()=>{
  const hasDraftProtection = app.includes("PURCHASE_DRAFT_KEY") && app.includes("beforeunload");
  assert.strictEqual(hasDraftProtection, true);
});
test("حذف المورد عبر endpoint صريح مع صلاحية",()=>{
  assert.ok(app.includes("/api/suppliers/${encodeURIComponent(id)}") && app.includes('method:"DELETE"'));
  assert.ok(server.includes('canPartyAction(source, user, "delete-party")') && server.includes('operationType:"SUPPLIER_DELETED"'));
});

test("Purchase stale retry module is versioned",()=>{
  assert.ok(server.includes('"purchase-stale-retry.js"'));
  assert.ok(fs.readFileSync(path.join(__dirname,"..","app","index.html"),"utf8").includes('src="purchase-stale-retry.js"'));
});

console.log(`${passed}/14 database persistence tests passed`);
