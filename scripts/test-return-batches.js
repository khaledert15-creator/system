'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Inventory=require('../app/purchase-inventory-integrity.js');
const source=fs.readFileSync('app/app.js','utf8');
function fn(name){const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));assert(start>=0,name);return source.slice(start,source.indexOf('\n}',start)+2);}
function context(db){
  const c={data:db,today:()=>'2026-10-17',nextId:(prefix,rows)=>`${prefix}${String(rows.length+1).padStart(3,'0')}`,productCoverPrice:book=>Number(book.price||0),productInventorySummary:()=>({averageInventoryCost:7}),latestApprovedPurchaseCost:()=>null,getBook:id=>db.books.find(b=>b.id===id),recordStockMovement:()=>{},saveData:()=>{},showPurchasesList:()=>{},toast:()=>{}};
  vm.createContext(c);
  for(const name of ['createInventoryBatch','receivePurchase'])vm.runInContext(fn(name),c);
  return c;
}

// Sold 2 copies from two batches, then return them one at a time (returns are recorded by app/returns.js).
const Returns=require('../app/returns.js');let serial=0;const actor={username:'owner',name:'Owner',uuid:()=>`u${++serial}`};
const giveBack=(db,saleId,qty)=>Returns.createSaleReturn(db,{invoiceId:saleId,lines:[{documentId:saleId,lineIndex:0,qty}],settlement:'no-settlement',reason:'اختبار',operationKey:`k${++serial}`},actor);
let db={customers:[{id:'C1',name:'عميل',balance:0}],books:[{id:'B1',stock:4,price:20}],inventoryBatches:[{id:'BAT-001',batchId:'BAT-001',productId:'B1',bookId:'B1',remainingQty:0,unitCost:5},{id:'BAT-002',batchId:'BAT-002',productId:'B1',bookId:'B1',remainingQty:4,unitCost:6}],
  sales:[{id:'INV-1',customerId:'C1',total:60,paid:60,remaining:0,status:'معتمدة',lines:[{bookId:'B1',qty:3,price:20,batchAllocations:[{batchId:'BAT-001',qty:1,unitCost:5},{batchId:'BAT-002',qty:1,unitCost:6}]}]}],returns:[],cash:[],stockMovements:[]};
giveBack(db,'INV-1',1);
assert.equal(db.inventoryBatches[1].remainingQty,5,'latest allocation is restored first');
giveBack(db,'INV-1',1);
assert.equal(db.inventoryBatches[0].remainingQty,1);
assert.equal(db.inventoryBatches.reduce((s,b)=>s+b.remainingQty,0),db.books[0].stock);
giveBack(db,'INV-1',1);
assert.equal(db.inventoryBatches.length,3,'a copy beyond the traced ones goes to a new batch instead of inflating sold batches');
assert.equal(db.inventoryBatches[2].source,'sales_return');assert.equal(db.inventoryBatches[2].unitCost,5);
assert.equal(db.inventoryBatches.reduce((s,b)=>s+b.remainingQty,0),db.books[0].stock);
console.log('PASS sales returns put copies back into the batches they were sold from');

db={customers:[{id:'C1',name:'عميل',balance:0}],books:[{id:'B2',stock:0,price:30,cost:7}],inventoryBatches:[],sales:[{id:'INV-2',customerId:'C1',total:30,paid:30,remaining:0,status:'معتمدة',lines:[{bookId:'B2',qty:1,price:30}]}],returns:[],cash:[],stockMovements:[]};
giveBack(db,'INV-2',1);
assert.equal(db.inventoryBatches.length,1);assert.equal(db.inventoryBatches[0].remainingQty,1);assert.equal(db.inventoryBatches[0].unitCost,7,'falls back to the book cost');
console.log('PASS untraceable returns create a batch at the known cost');

db={books:[{id:'B3',stock:2,price:50}],inventoryBatches:[{id:'BAT-001',batchId:'BAT-001',productId:'B3',bookId:'B3',remainingQty:2,unitCost:30}],sales:[],
  purchases:[{id:'PUR-1',status:'بانتظار الفحص',type:'شراء',supplierId:'S1',date:'2026-10-17',shipping:10,lines:[{bookId:'B3',qty:5,cost:40,finalNet:200}]}]};
const c=context(db);c.receivePurchase('PUR-1');
assert.equal(db.books[0].stock,7);
assert.equal(db.inventoryBatches.reduce((s,b)=>s+b.remainingQty,0),7,'received purchase adds a matching batch');
assert.equal(db.inventoryBatches[1].unitCost,42,'unit cost includes the shipping share');
assert.equal(db.purchases[0].lines[0].batchId,db.inventoryBatches[1].batchId);
console.log('PASS receiving a pending purchase creates its FIFO batch');
