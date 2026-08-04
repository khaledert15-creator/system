#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Integrity = require("../app/purchase-inventory-integrity.js");

const fixture = () => ({
  books:[{ id:"B1", name:"Senior 100", barcode:"DC1", extraBarcode:"ALT1", supplierId:"S1", coverPrice:110, stock:0 }],
  purchases:[], inventoryBatches:[], stockMovements:[]
});

function apply(db, id, lines) {
  const before = JSON.parse(JSON.stringify(db));
  const resolved = Integrity.resolvePurchaseLines(db.books, lines);
  const purchase = { id, total:resolved.reduce((sum,line)=>sum+Number(line.qty)*Number(line.cost),0), lines:resolved.map(line=>({ ...line, quantity:line.qty, batchId:`BAT-${id}-${line.bookId}` })) };
  for (const line of purchase.lines) {
    const book = db.books.find(row=>row.id===line.bookId), beforeStock=book.stock;
    book.stock += Number(line.qty);
    db.inventoryBatches.push({ id:line.batchId, batchId:line.batchId, productId:line.bookId, bookId:line.bookId, purchaseInvoiceId:id, receivedQty:line.qty, remainingQty:line.qty });
    db.stockMovements.push({ id:`MOV-${id}-${line.bookId}`, bookId:line.bookId, documentId:id, quantity:line.qty, before:beforeStock, after:book.stock });
  }
  Integrity.validatePurchaseEffects(before,db,purchase,{inventoryAffecting:true});
  db.purchases.push(purchase);
  return purchase;
}

let passed=0;
function test(name,fn){try{fn();passed+=1;console.log(`PASS ${name}`);}catch(error){console.error(`FAIL ${name}: ${error.stack||error.message}`);process.exitCode=1;}}

test("single purchase line creates movement batch and stock",()=>{const db=fixture();apply(db,"PUR-1",[{bookId:"B1",qty:2,cost:10}]);assert.strictEqual(db.books[0].stock,2);assert.strictEqual(db.inventoryBatches.length,1);assert.strictEqual(db.stockMovements.length,1);});
test("two purchases for the same product accumulate stock",()=>{const db=fixture();apply(db,"PUR-1",[{bookId:"B1",qty:200,cost:10}]);apply(db,"PUR-2",[{bookId:"B1",qty:60,cost:10}]);assert.strictEqual(db.books[0].stock,260);assert.strictEqual(db.stockMovements.length,2);});
test("line without product reference is blocked",()=>{assert.throws(()=>Integrity.resolvePurchaseLines(fixture().books,[{qty:1}]),error=>error.code==="PURCHASE_PRODUCT_REQUIRED");});
test("barcode-only line resolves to one canonical product",()=>{const rows=Integrity.resolvePurchaseLines(fixture().books,[{barcode:"DC1",qty:1}]);assert.strictEqual(rows[0].bookId,"B1");assert.strictEqual(rows[0].productId,"B1");});
test("multi-line purchase cannot silently omit an inventory effect",()=>{const db=fixture();db.books.push({id:"B2",name:"Other",barcode:"DC2",supplierId:"S1",coverPrice:20,stock:0});const before=JSON.parse(JSON.stringify(db));const purchase={id:"PUR-X",lines:[{bookId:"B1",qty:1},{bookId:"B2",qty:1}]};db.books[0].stock=1;db.inventoryBatches.push({id:"BAT-X",bookId:"B1",productId:"B1",purchaseInvoiceId:"PUR-X",receivedQty:1});db.stockMovements.push({id:"MOV-X",bookId:"B1",documentId:"PUR-X",quantity:1});assert.throws(()=>Integrity.validatePurchaseEffects(before,db,purchase),error=>error.code==="PURCHASE_INVENTORY_VALIDATION_FAILED");});
test("purchase total is unchanged by inventory effects",()=>{const db=fixture();const purchase=apply(db,"PUR-1",[{bookId:"B1",qty:3,cost:7.5}]);assert.strictEqual(purchase.total,22.5);});
test("product movement report source contains purchase movement",()=>{const db=fixture();apply(db,"PUR-1",[{bookId:"B1",qty:4,cost:10}]);assert.strictEqual(db.stockMovements.filter(row=>row.bookId==="B1"&&row.documentId==="PUR-1").length,1);});
test("reload preserves saved stock movement and batch",()=>{const db=fixture();apply(db,"PUR-1",[{bookId:"B1",qty:5,cost:10}]);const reload=JSON.parse(JSON.stringify(db));assert.strictEqual(reload.books[0].stock,5);Integrity.validatePurchaseEffects(fixture(),reload,reload.purchases[0],{inventoryAffecting:true});});
test("duplicate normalized product identity is blocked",()=>{const db=fixture();const conflicts=Integrity.productIdentityConflicts(db.books,{name:"  SENIOR 100 ",barcode:"NEW",supplierId:"S1",coverPrice:110});assert.deepStrictEqual(conflicts.map(row=>row.id),["B1"]);});

console.log(`${passed}/9 purchase inventory integrity tests passed`);
