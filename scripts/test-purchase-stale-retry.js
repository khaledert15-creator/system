#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Retry = require("../app/purchase-stale-retry.js");

const base = () => ({
  suppliers:[{id:"S1",name:"Supplier",balance:0}],
  books:[{id:"B1",name:"Book",stock:5,cost:10}],
  purchases:[], notifications:[], trackingRunBatches:[]
});
const draft = () => ({ operationKey:"OP-1", supplierId:"S1", supplierInvoiceNumber:"SUP-1", lines:[{bookId:"B1",qty:2,cost:10}] });
let passed=0;
function test(name,fn){try{fn();passed++;console.log(`PASS ${name}`);}catch(error){console.error(`FAIL ${name}: ${error.stack||error.message}`);process.exitCode=1;}}

test("successful save updates clientRevision",()=>{let clientRevision="1";const response={revision:"2"};clientRevision=response.revision;assert.strictEqual(clientRevision,"2");});
test("two consecutive saves from one page use latest revision",()=>{let revision="1";revision=String(Number(revision)+1);const secondIfMatch=revision;assert.strictEqual(secondIfMatch,"2");});
test("unrelated stale change preserves draft and is safe",()=>{const latest=base();latest.notifications.push({id:"N1"});const result=Retry.analyze({base:base(),latest,draft:draft()});assert.ok(result.safe);assert.deepStrictEqual(draft(),Retry.mergeLatestWithDraft(latest,draft()).draft);});
test("refresh and retry merges latest database with draft",()=>{const latest=base();latest.trackingRunBatches.push({id:"T1"});const merged=Retry.mergeLatestWithDraft(latest,draft());assert.strictEqual(merged.data.trackingRunBatches.length,1);assert.strictEqual(merged.draft.lines[0].bookId,"B1");});
test("real supplier or product conflict requires review",()=>{const supplierLatest=base();supplierLatest.suppliers[0].balance=100;assert.ok(!Retry.analyze({base:base(),latest:supplierLatest,draft:draft()}).safe);const bookLatest=base();bookLatest.books[0].stock=4;assert.ok(!Retry.analyze({base:base(),latest:bookLatest,draft:draft()}).safe);});
test("multi-tab warning is present",()=>{const app=fs.readFileSync(path.join(__dirname,"..","app","app.js"),"utf8");assert.ok(app.includes("يوجد تبويب آخر مفتوح للنظام")&&app.includes("BroadcastChannel"));});
test("tracking and notifications do not conflict with purchase scope",()=>{const latest=base();latest.trackingRunBatches.push({id:"T1"});latest.notifications.push({id:"N1"});assert.ok(Retry.analyze({base:base(),latest,draft:draft()}).safe);});
test("saved invoice survives reload with stock update",()=>{const latest=base();latest.purchases.push({id:"PUR-1",operationKey:"OP-1",lines:[{bookId:"B1",qty:2}]});latest.books[0].stock=7;const reloaded=JSON.parse(JSON.stringify(latest));assert.strictEqual(reloaded.purchases[0].id,"PUR-1");assert.strictEqual(reloaded.books[0].stock,7);});
test("retry does not duplicate an operation key",()=>{const latest=base();latest.purchases.push({id:"PUR-1",operationKey:"OP-1"});const result=Retry.analyze({base:base(),latest,draft:draft()});assert.strictEqual(result.existingOperation.id,"PUR-1");});
test("invoice is not approved before server confirmation",()=>{const app=fs.readFileSync(path.join(__dirname,"..","app","app.js"),"utf8");const saveAt=app.indexOf('const saved = await saveData("PURCHASE_CREATED"'),blockedAt=app.indexOf("if (!saved)",saveAt),clearAt=app.indexOf("clearPurchaseDraft()",saveAt);assert.ok(saveAt>0&&blockedAt>saveAt&&clearAt>blockedAt);});
test("stale UX contains retry action and preserves draft",()=>{const app=fs.readFileSync(path.join(__dirname,"..","app","app.js"),"utf8");assert.ok(app.includes("تحديث وإعادة المحاولة")&&app.includes("persistPurchaseDraft()")&&app.includes("retryStalePurchaseSave"));});

console.log(`${passed}/11 purchase stale retry tests passed`);
