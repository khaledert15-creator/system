'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Integrity=require('../app/purchase-inventory-integrity.js');
const source=fs.readFileSync('app/app.js','utf8'),serverSource=fs.readFileSync('server-node.js','utf8');
function fn(src,name){const start=src.search(new RegExp(`(?:async )?function ${name}\\(`));assert(start>=0,name);return src.slice(start,src.indexOf('\n}',start)+2);}

// Ids as found on production: server UUID ids plus the broken float ids the old generator produced.
const productionLikeMovements=[
  {id:'MOV-0f4f7d10-6426-4fb9-bd5d-9473a0feccc2'},{id:'MOV-1a666364-f1a1-4677-9201-f3bdad443d19'},
  {id:'MOV-2.3412404047828986e+26'},{id:'MOV-2.3412404047828986e+26'},{id:'MOV-014'}
];
for(const [label,src] of [['browser',source],['server',serverSource]]){
  const c={};vm.createContext(c);vm.runInContext(fn(src,'nextId'),c);
  const a=c.nextId('MOV-',productionLikeMovements);
  assert.equal(/e\+/.test(a),false,`${label}: no exponent ids`);
  assert(!productionLikeMovements.some(m=>m.id===a),`${label}: new id is unique`);
  const b=c.nextId('MOV-',[...productionLikeMovements,{id:a}]);
  assert.notEqual(a,b,`${label}: consecutive ids differ`);
  assert.equal(c.nextId('TX-',[{id:'TX-0019'},{id:'TX-59c25915-53f8-4fe3-9fdd-13843282bc55'}]).replace(/^TX-0*/,''),'20',`${label}: UUID ids do not disturb the sequence`);
}
console.log('PASS ids stay unique and sequential next to UUID and float ids');

// A purchase approval now records one recognisable movement per line.
const data={stockMovements:structuredClone(productionLikeMovements),books:[{id:'B1',stock:2},{id:'B2',stock:0}],inventoryBatches:[]};
const c={data,actorSnapshot:()=>({userId:'U1',username:'owner',name:'Owner',role:'مالك'}),operationDateParts:()=>({}),movementDocumentContext:()=>({}),productInventorySummary:()=>({averageInventoryCost:10}),productDefaultSellingPrice:()=>20,globalThis:{crypto:require('node:crypto')}};
vm.createContext(c);vm.runInContext(fn(source,'nextId')+'\n'+fn(source,'recordStockMovement')+'\n'+fn(source,'createInventoryBatch')+';today=()=>"2026-10-18";',c);
const before=structuredClone(data),purchase={id:'PUR-500',lines:[{bookId:'B1',qty:7},{bookId:'B2',qty:3}]};
for(const line of purchase.lines){const book=data.books.find(b=>b.id===line.bookId);const was=book.stock;book.stock+=line.qty;vm.runInContext(`createInventoryBatch({productId:${JSON.stringify(book.id)},purchaseInvoiceId:"PUR-500",supplierId:"S1",qty:${line.qty},unitCost:10})`,c);c.recordStockMovement(book,'شراء',line.qty,was,book.stock,'PUR-500','');}
const ids=data.stockMovements.map(m=>m.id);assert.equal(new Set(ids).size,ids.length-1,'only the pre-existing duplicate remains');
assert.deepEqual(Integrity.validatePurchaseEffects(before,data,purchase).valid,true);
console.log('PASS a purchase approval passes the inventory check with production-like ids');
