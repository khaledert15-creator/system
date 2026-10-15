"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("app/app.js", "utf8");
const integrity = require("../app/purchase-inventory-integrity.js");
function fn(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert(start >= 0);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
const fixture = () => ({books:[],inventoryBatches:[],stockMovements:[],audit:[],settings:{},sales:[]});
function context() {
  const c = { data:fixture(), serverConnected:true, saleSaveInFlight:false, lastSaveError:null, saveQueue:Promise.resolve(), dbRevision:"old", draftSale:{lines:[{bookId:"B1",qty:2}],customerId:"C1"}, structuredClone, AbortSignal, PurchaseInventoryIntegrity:integrity, messages:[], renderSaleInvoice(){}, updateSaleSummary(){}, cacheDataLocally(){}, snapshotClientData(){return structuredClone(c.data);}, restoreClientData(d){c.data=d;}, toast(m){c.messages.push(m);}, saveFailureMessage(){return "save failed";}, getBook(id){return c.data.books.find(b=>b.id===id);}, today:()=>"2026-10-15", productCoverPrice:b=>b.coverPrice||0, latestApprovedPurchaseCost:()=>0, productInventorySummary(id){return {averageInventoryCost:0,currentStockQty:c.data.inventoryBatches.filter(b=>b.productId===id).reduce((sum,b)=>sum+b.remainingQty,0)};}, nextId:()=>"B1", globalThis:{crypto:{randomUUID:()=>"unique"}}, recordStockMovement(...args){c.data.stockMovements.push(args);}, closeModal(){}, renderBooks(){}, saveData:async()=>true };
  c.fetchLatestDatabaseForPurchase=async()=>({data:structuredClone(c.data),revision:"new"});
  c.createInventoryBatch=({productId,qty,unitCost})=>c.data.inventoryBatches.push({id:`batch-${c.data.inventoryBatches.length}`,productId,remainingQty:qty,unitCost});
  vm.createContext(c);
  vm.runInContext(fn("synchronizeStockAdjustment")+"\n"+fn("bookEditFingerprint"),c);
  return c;
}
async function run() {
  const bookStart=source.indexOf('  if (form.id === "book-form") {');
  const bookEnd=source.indexOf('  if (form.id === "party-form") {',bookStart);
  const bookHandler=`async function submitBook(form, formData) { ${source.slice(bookStart,bookEnd)} }`;
  for (const failed of [false,true]) {
    const c=context();vm.runInContext(bookHandler,c);
    if(failed)c.saveData=async()=>false;
    const button={disabled:false};
    await c.submitBook({id:"book-form",dataset:{editId:""},querySelector:()=>button},{name:"Book",stock:"5",defaultSellingPrice:"10"});
    assert.equal(button.disabled,false);
    assert.equal(c.data.books.length,failed?0:1);
    if(!failed){assert.equal(c.data.books[0].stock,5);assert.equal(c.data.inventoryBatches[0].remainingQty,5);assert.equal(c.data.stockMovements.length,1);
      await c.submitBook({id:"book-form",dataset:{editId:"B1"},querySelector:()=>button},{name:"Book",stock:"8",defaultSellingPrice:"10"});
      assert.equal(c.data.books[0].stock,8);assert.equal(c.data.inventoryBatches.reduce((n,b)=>n+b.remainingQty,0),8);
    }
  }
  console.log("PASS item quantities update batches and movements; failed saves roll back");
  const edited=context();vm.runInContext(bookHandler,edited);
  edited.data.books=[{id:"B1",name:"Book",stock:2,price:10,lastPurchasePrice:null}];
  edited.data.inventoryBatches=[{id:"batch",productId:"B1",remainingQty:2}];
  const originalFingerprint=edited.bookEditFingerprint(edited.data.books[0]);
  edited.fetchLatestDatabaseForPurchase=async()=>({revision:"new",data:{...structuredClone(edited.data),books:[{lastPurchasePrice:0,reservedStock:0,unit:"قطعة",defaultSellingPrice:10,coverPrice:10,itemType:"صنف عام",...edited.data.books[0],lastPurchasePrice:0}]}});
  edited.globalThis={};
  const editForm={id:"book-form",dataset:{editId:"B1",editSnapshot:originalFingerprint},querySelector:()=>({disabled:false})};
  await edited.submitBook(editForm,{name:"Updated",stock:"3",defaultSellingPrice:"12",coverPrice:"10"});
  assert.equal(edited.data.books[0].name,"Updated");assert.equal(edited.data.books[0].stock,3);assert.equal(edited.data.inventoryBatches.reduce((n,b)=>n+b.remainingQty,0),3);
  const fresh=structuredClone(edited.data);edited.fetchLatestDatabaseForPurchase=async()=>({revision:"newer",data:fresh});
  await edited.submitBook(editForm,{name:"Overwrite",stock:"1"});
  assert.equal(edited.data.books[0].name,"Updated");assert.match(edited.messages.at(-1),/جهاز آخر/);
  console.log("PASS normalized record edits save without randomUUID; genuinely stale forms remain blocked");

  const c=context();vm.runInContext(fn("saveSale"),c);
  c.data.books=[{id:"B1",stock:8}];
  c.fetchLatestDatabaseForPurchase=async()=>({data:{...fixture(),books:[{id:"B1",stock:1}]},revision:"latest"});
  let calls=0;
  c.commitSale=async()=>{calls++;assert.equal(c.data.books[0].stock,1);c.data.books[0].stock=0;throw Object.assign(new Error("batch error"),{code:"INSUFFICIENT_BATCH_STOCK"});};
  await c.saveSale();assert.equal(c.saleSaveInFlight,false);assert.equal(c.data.books[0].stock,1);assert.equal(c.draftSale.lines[0].qty,2);
  c.commitSale=async()=>{calls++;return {id:"INV1"};};
  assert.equal((await c.saveSale()).id,"INV1");assert.equal(calls,2);assert.equal(c.saleSaveInFlight,false);
  c.fetchLatestDatabaseForPurchase=async()=>{throw new Error("network timeout");};
  await c.saveSale();assert.equal(c.saleSaveInFlight,false);assert.equal(c.draftSale.lines[0].qty,2);
  console.log("PASS sale reads latest stock, rolls back exceptions, releases lock, allows retry");
  const d=context();vm.runInContext(fn("commitSale"),d);
  d.data.books=[{id:"B1",name:"Book",stock:3}];d.data.inventoryBatches=[{productId:"B1",remainingQty:3}];
  d.draftSale.lines=[{bookId:"B1",qty:2},{bookId:"B1",qty:2}];d.data.settings.allowNegativeStock=true;
  d.getCustomer=()=>({id:"C1"});d.saleTotals=()=>({lines:[{},{}]});
  await d.commitSale();assert.match(d.messages[0],/3.*4/);
  console.log("PASS repeated product lines cannot exceed stock even with negative stock setting");
  const e=context();vm.runInContext(fn("commitSale"),e);
  e.data.books=[{id:"B1",name:"Book",stock:3}];e.data.inventoryBatches=[{id:"BAT1",productId:"B1",remainingQty:3,unitCost:2}];e.data.cash=[];
  e.draftSale.lines=[{bookId:"B1",qty:2,price:10}];e.draftSale.paid=20;
  const customer={id:"C1",name:"Customer",balance:0};
  e.getCustomer=()=>customer;e.saleTotals=()=>({lines:[{finalNet:20}],total:20,subtotal:20,shipping:0});
  e.negativeStockError=()=>"";e.document={getElementById:id=>({value:id==="sale-payment"?"نقدي":"2026-10-15"})};
  e.OrderFinance={normalizeNote:x=>x};e.customerSnapshot=x=>x;e.actorSnapshot=()=>({});e.recordNegativeStockOverride=()=>{};
  e.allocateInventoryFIFO=(id,qty)=>integrity.consumeBatchesFIFO(e.data,id,qty);e.resetSaleDraft=()=>{e.draftSale={lines:[]};};e.renderSales=()=>{};
  const saved=await e.commitSale();assert(saved);assert.equal(e.data.sales.length,1);assert.equal(e.data.books[0].stock,1);assert.equal(e.data.inventoryBatches[0].remainingQty,1);assert.equal(e.data.cash[0].amount,20);
  console.log("PASS successful sale saves invoice, payment and matching stock deduction");
  assert.match(fn("updateSaleSummary"),/warning\.hidden = !insufficient/);
  console.log("PASS quantity editing refreshes inline stock warning");
}
run().catch(e=>{console.error(e);process.exitCode=1;});
