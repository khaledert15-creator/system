#!/usr/bin/env node
"use strict";
const assert=require("assert"),Returns=require("../app/returns.js");
let serial=0;const actor={username:"owner",name:"مالك النظام",uuid:()=>`u-${++serial}`};
const pass=(name,fn)=>{fn();console.log(`PASS ${name}`);};
const clone=v=>JSON.parse(JSON.stringify(v));
const key=()=>`k-${++serial}`;

function fixture(){return{
  customers:[{id:"C1",name:"عميل",balance:200,points:10},{id:"C2",name:"عميل تاني",balance:0}],
  suppliers:[{id:"S1",name:"مورد",balance:500}],
  books:[{id:"B1",name:"كتاب 1",stock:5,price:150,cost:90},{id:"B2",name:"كتاب 2",stock:5,price:150,cost:90}],
  inventoryBatches:[{id:"BAT-001",batchId:"BAT-001",productId:"B1",remainingQty:2,unitCost:80,purchaseDate:"2026-01-01"},{id:"BAT-002",batchId:"BAT-002",productId:"B1",remainingQty:3,unitCost:90,purchaseDate:"2026-02-01"},{id:"BAT-003",batchId:"BAT-003",productId:"B2",remainingQty:5,unitCost:90,purchaseDate:"2026-01-01"}],
  sales:[
    {id:"I1",customerId:"C1",total:300,paid:100,remaining:200,status:"معتمدة",pointsAwarded:6,onlineOrderId:"O1",lines:[{bookId:"B1",qty:2,price:150,finalNet:300,batchAllocations:[{batchId:"BAT-001",qty:1,unitCost:80},{batchId:"BAT-002",qty:1,unitCost:90}]}]},
    {id:"I2",customerId:"C1",total:150,paid:150,remaining:0,status:"معتمدة",lines:[{bookId:"B2",qty:1,price:150,finalNet:150,batchAllocations:[{batchId:"BAT-003",qty:1,unitCost:90}]}]},
    {id:"I3",customerId:"C2",total:150,paid:150,remaining:0,status:"معتمدة",lines:[{bookId:"B2",qty:1,price:150,finalNet:150}]}],
  onlineOrders:[{id:"O1",status:"تم الشحن",workflowStage:"shipped",saleId:"I1"}],
  shipments:[{id:"SH1",invoiceId:"I1",onlineOrderId:"O1",status:"خرج للتوصيل",normalizedStatus:"in_transit",shippingStatus:"in_transit"}],
  purchases:[
    {id:"P1",supplierId:"S1",type:"شراء",total:400,paid:100,remaining:300,status:"مستلمة",lines:[{bookId:"B1",qty:4,cost:100,finalNet:400,batchId:"BAT-002"}]},
    {id:"P2",supplierId:"S1",type:"أمانة",total:300,paid:0,remaining:0,status:"مستلمة",lines:[{bookId:"B2",qty:3,cost:100,finalNet:300}]}],
  cash:[],cashAccounts:[{id:"CA1",name:"الخزينة الرئيسية",active:true}],returns:[],stockMovements:[]
};}
const batch=(db,id)=>db.inventoryBatches.find(b=>b.id===id).remainingQty;
const stockSum=(db,book)=>db.inventoryBatches.filter(b=>b.productId===book).reduce((s,b)=>s+b.remainingQty,0);

pass("Partial then full return from one invoice: debt first, batches, statuses, order and shipment",()=>{
  const db=fixture();
  const first=Returns.createSaleReturn(db,{invoiceId:"I1",lines:[{documentId:"I1",lineIndex:0,qty:1}],settlement:"cash",reason:"اختبار",operationKey:key()},actor).record;
  // 150 returned: 200 still owed on 300 → 100 clears the debt, 50 is paid back in cash.
  assert.equal(first.debtReduction,100);assert.equal(first.customerDue,50);assert.equal(first.paidAmount,50);
  assert.equal(db.customers[0].balance,100);assert.equal(db.sales[0].status,"مرتجع جزئي");assert.equal(db.sales[0].remaining,100);assert.equal(db.sales[0].paid,50);
  assert.equal(batch(db,"BAT-002"),4,"latest allocation restored first");assert.equal(db.books[0].stock,6);
  assert.equal(db.cash.length,1);assert.equal(db.cash[0].amount,50);assert.equal(db.cash[0].type,"صرف");
  assert.equal(db.onlineOrders[0].status,"تم الشحن");
  Returns.createSaleReturn(db,{invoiceId:"I1",lines:[{documentId:"I1",lineIndex:0,qty:1}],settlement:"cash",reason:"اختبار",operationKey:key()},actor);
  assert.equal(db.sales[0].status,"مرتجع");assert.equal(db.customers[0].balance,0);assert.equal(batch(db,"BAT-001"),3);
  assert.equal(stockSum(db,"B1"),db.books[0].stock,"stock and batches stay equal");
  assert.equal(db.onlineOrders[0].status,"مرتجع");assert.equal(db.onlineOrders[0].workflowStage,"returned");
  assert.equal(db.shipments[0].normalizedStatus,"returned");
  assert.equal(db.customers[0].points,4,"points of the returned value go back");
});

pass("Return across several invoices with return shipping: per-invoice debt and money",()=>{
  const db=fixture();
  const r=Returns.createSaleReturn(db,{customerId:"C1",lines:[{documentId:"I1",lineIndex:0,qty:1},{documentId:"I2",lineIndex:0,qty:1}],settlement:"cash",returnShippingDeduction:20,reason:"اختبار",operationKey:key()},actor).record;
  assert.equal(r.subtotal,280);assert.equal(r.debtReduction,100);assert.equal(r.customerDue,180);assert.equal(r.returnShippingDeduction,20);
  assert.equal(db.customers[0].balance,100);
  assert.equal(db.sales[0].remaining,100);assert.equal(db.sales[1].status,"مرتجع");
  assert.equal(Math.round((db.sales[0].returnedPaid+db.sales[1].returnedPaid)*100)/100,180,"paid back is split between the invoices");
});

pass("Rejected inputs change nothing",()=>{
  const db=fixture(),before=JSON.stringify(db);
  const tries=[
    [{invoiceId:"I1",lines:[{documentId:"I1",lineIndex:0,qty:3}]},/أكبر من المتاح/],
    [{lines:[{documentId:"I1",lineIndex:0,qty:1},{documentId:"I3",lineIndex:0,qty:1}]},/نفس العميل/],
    [{invoiceId:"I1",lines:[{documentId:"I1",lineIndex:0,qty:0}]},/حدد كمية/],
    [{invoiceId:"I1",lines:[{documentId:"I1",lineIndex:0,qty:-1}]},/رقم صحيح/],
    [{invoiceId:"I1",lines:[{documentId:"I1",lineIndex:0,qty:1}],settlement:"gift"},/طريقة تسوية/],
    [{invoiceId:"I1",lines:[{documentId:"I1",lineIndex:0,qty:1}],reason:""},/سبب/]];
  for(const [payload,error] of tries)assert.throws(()=>Returns.createSaleReturn(db,{reason:"x",settlement:"cash",operationKey:key(),...payload},actor),error);
  db.sales[0].status="ملغاة";assert.throws(()=>Returns.createSaleReturn(db,{invoiceId:"I1",lines:[{documentId:"I1",lineIndex:0,qty:1}],reason:"x",operationKey:key()},actor),/غير متاح/);
  db.sales[0].status="معتمدة";assert.equal(JSON.stringify(db),before);
});

pass("The same operation key records the return once",()=>{
  const db=fixture(),payload={invoiceId:"I2",lines:[{documentId:"I2",lineIndex:0,qty:1}],settlement:"cash",reason:"x",operationKey:"same"};
  Returns.createSaleReturn(db,payload,actor);assert.equal(Returns.createSaleReturn(db,payload,actor).existing,true);
  assert.equal(db.returns.length,1);assert.equal(db.books[1].stock,6);
});

pass("Debt-only settlement records the balance change that really happened",()=>{
  const db=fixture();db.customers[0].balance=30;
  const r=Returns.createSaleReturn(db,{invoiceId:"I2",lines:[{documentId:"I2",lineIndex:0,qty:1}],settlement:"debt-only",reason:"x",operationKey:key()},actor).record;
  assert.equal(db.customers[0].balance,0);assert.equal(r.balanceEffect,-30);
});

pass("Reversing a sale return puts everything back as it was",()=>{
  const db=fixture(),start=clone(db);
  const r=Returns.createSaleReturn(db,{invoiceId:"I1",lines:[{documentId:"I1",lineIndex:0,qty:2}],settlement:"cash",reason:"x",operationKey:key()},actor).record;
  assert.equal(db.onlineOrders[0].status,"مرتجع");
  assert.throws(()=>Returns.reverseReturn(db,r.id,{reason:""},actor),/سبب/);
  Returns.reverseReturn(db,r.id,{reason:"اتسجل غلط"},actor);
  for(const k of ["books","inventoryBatches","customers","onlineOrders"])assert.deepEqual(db[k].map(row=>({...row,updatedAt:undefined})),start[k].map(row=>({...row,updatedAt:undefined})),k);
  const sale=db.sales[0];assert.equal(sale.status,"معتمدة");assert.equal(sale.paid,100);assert.equal(sale.remaining,200);assert.equal(sale.returnedPaid,0);
  assert.deepEqual(sale.lines[0].batchAllocations.map(a=>a.returnedQty||0),[0,0]);
  assert.equal(db.shipments[0].normalizedStatus,"in_transit");
  assert.equal(db.cash.length,2);assert.equal(db.cash[1].type,"قبض");assert.equal(db.cash[1].reversesId,db.cash[0].id);
  assert.equal(r.status,"ملغى");assert.ok(r.deletedAt);
  assert.equal(Returns.returnedQuantities(db,"sale","I1").size,0,"a reversed return no longer counts");
  Returns.createSaleReturn(db,{invoiceId:"I1",lines:[{documentId:"I1",lineIndex:0,qty:2}],settlement:"cash",reason:"x",operationKey:key()},actor);
});

pass("A return cannot be reversed once its books were sold again, or before a later return",()=>{
  const db=fixture();
  const first=Returns.createSaleReturn(db,{invoiceId:"I1",lines:[{documentId:"I1",lineIndex:0,qty:1}],settlement:"cash",reason:"x",operationKey:key()},actor).record;
  Returns.createSaleReturn(db,{invoiceId:"I1",lines:[{documentId:"I1",lineIndex:0,qty:1}],settlement:"cash",reason:"x",operationKey:key()},actor);
  assert.throws(()=>Returns.reverseReturn(db,first.id,{reason:"x"},actor),/مرتجع أحدث/);
  const db2=fixture();
  const r=Returns.createSaleReturn(db2,{invoiceId:"I2",lines:[{documentId:"I2",lineIndex:0,qty:1}],settlement:"cash",reason:"x",operationKey:key()},actor).record;
  db2.inventoryBatches.find(b=>b.id==="BAT-003").remainingQty=0;db2.books[1].stock=0;
  const before=JSON.stringify(db2);
  assert.throws(()=>Returns.reverseReturn(db2,r.id,{reason:"x"},actor),/اتباعت تاني/);
  assert.equal(JSON.stringify(db2),before);
});

pass("Purchase return from one document: own batch, debt, paid share back in cash",()=>{
  const db=fixture();
  const r=Returns.createPurchaseReturn(db,{purchaseId:"P1",lines:[{documentId:"P1",lineIndex:0,qty:2}],account:"CA1",reason:"تالف",operationKey:key()},actor).record;
  assert.equal(batch(db,"BAT-002"),1,"taken from the purchase's own batch");assert.equal(db.books[0].stock,3);
  assert.equal(stockSum(db,"B1"),db.books[0].stock);
  // 200 returned of 400: 150 of the 300 owed is cleared and 50 of the 100 paid comes back.
  assert.equal(r.remainingReduction,150);assert.equal(r.paidAmount,50);assert.equal(db.suppliers[0].balance,350);
  assert.equal(db.cash[0].type,"قبض");assert.equal(db.purchases[0].status,"مرتجع جزئي");
  Returns.reverseReturn(db,r.id,{reason:"x"},actor);
  assert.equal(batch(db,"BAT-002"),3);assert.equal(db.books[0].stock,5);assert.equal(db.suppliers[0].balance,500);assert.equal(db.purchases[0].remaining,300);assert.equal(db.purchases[0].status,"مستلمة");
});

pass("Supplier return by account: consignment moves no money, batches FIFO, shortage refused",()=>{
  const db=fixture();
  const r=Returns.createPurchaseReturn(db,{supplierId:"S1",lines:[{documentId:"P1",lineIndex:0,qty:1},{documentId:"P2",lineIndex:0,qty:1}],settlement:"account-credit",reason:"x",operationKey:key()},actor).record;
  assert.equal(r.subtotal,200);assert.equal(r.supplierDue,100,"only the bought book moves money");assert.equal(db.suppliers[0].balance,400);
  assert.equal(db.books[1].stock,4);assert.equal(stockSum(db,"B2"),4);
  const short=fixture();short.inventoryBatches.find(b=>b.id==="BAT-003").remainingQty=0;const before=JSON.stringify(short);
  assert.throws(()=>Returns.createPurchaseReturn(short,{supplierId:"S1",lines:[{documentId:"P2",lineIndex:0,qty:1}],settlement:"cash",reason:"x",operationKey:key()},actor),/الدفعات/);
  assert.equal(JSON.stringify(short),before);
});

pass("Refused deliveries and old returns without recorded effects are not reversed here",()=>{
  const db=fixture();db.returns.push({id:"RET-0009",type:"sales_return",mode:"refusal",sourceDocuments:["I1"]},{id:"RET-0010",type:"sales_return",sourceDocuments:["I2"]});
  assert.throws(()=>Returns.reverseReturn(db,"RET-0009",{reason:"x"},actor),/رفض الاستلام/);
  assert.throws(()=>Returns.reverseReturn(db,"RET-0010",{reason:"x"},actor),/قبل إضافة الإلغاء/);
});

(async()=>{
  const fs=require("fs"),os=require("os"),path=require("path"),net=require("net"),crypto=require("crypto"),{spawn}=require("child_process");
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"returns-api-"));let child;
  try{
    fs.cpSync("app",path.join(temp,"app"),{recursive:true});fs.copyFileSync("server-node.js",path.join(temp,"server-node.js"));fs.mkdirSync(path.join(temp,"data"));
    if(fs.existsSync("scripts/build-static-assets.js")){fs.mkdirSync(path.join(temp,"scripts"));fs.copyFileSync("scripts/build-static-assets.js",path.join(temp,"scripts/build-static-assets.js"));}
    const salt="s",password="test-password",hash=crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");
    const db={version:4,meta:{dataRevision:0},settings:{},audit:[],users:[{id:"U1",username:"owner",name:"Owner",role:"مالك",active:true,salt,passwordHash:hash},{id:"U2",username:"cashier",name:"Cashier",role:"كاشير",active:true,salt,passwordHash:hash}],...fixture()};
    fs.writeFileSync(path.join(temp,"data/database.json"),JSON.stringify(db));
    const port=await new Promise(resolve=>{const srv=net.createServer();srv.listen(0,"127.0.0.1",()=>{const p=srv.address().port;srv.close(()=>resolve(p));});});
    const base=`http://127.0.0.1:${port}`;
    child=spawn(process.execPath,["server-node.js"],{cwd:temp,env:{...process.env,PORT:String(port),HOST:"127.0.0.1",TRACKING_RPA_ENABLED:"false",NODE_ENV:"test"},stdio:"ignore"});
    for(let i=0;i<100;i+=1){try{if((await fetch(base+"/api/health")).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
    const login=async username=>(await (await fetch(base+"/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password})})).json()).token;
    const owner=await login("owner"),cashier=await login("cashier");
    const call=(token,route,body,method="POST",extra={})=>fetch(base+route,{method,headers:{"X-Session-Token":token,"Content-Type":"application/json",...extra},body:body===undefined?undefined:JSON.stringify(body)});
    assert.equal((await call("bad","/api/returns/sale",{})).status,401);
    const created=await call(cashier,"/api/returns/sale",{invoiceId:"I2",lines:[{documentId:"I2",lineIndex:0,qty:1}],settlement:"cash",account:"CA1",reason:"اختبار",operationKey:"api-1"});
    const body=await created.json();assert.equal(created.status,200,JSON.stringify(body));
    let saved=JSON.parse(fs.readFileSync(path.join(temp,"data/database.json"),"utf8"));
    assert.equal(saved.books.find(b=>b.id==="B2").stock,6);assert.equal(saved.returns.length,1);assert.equal(saved.audit.at(-1).action,"فاتورة مرتجع مبيعات");
    console.log("PASS a cashier records a sale return on the server in one step");
    const page=await (await call(owner,"/api/db",undefined,"GET")).json(),revision=String(saved.meta.dataRevision);
    page.returns=[];
    const put=await call(owner,"/api/db",page,"PUT",{"If-Match":revision});
    assert.equal(put.status,409);assert.equal((await put.json()).code,"RETURNS_SERVER_ONLY");
    console.log("PASS a whole-database save cannot add, change or drop returns");
    assert.equal((await call(cashier,`/api/returns/${body.return.id}/reverse`,{reason:"x"})).status,403);
    const reversed=await call(owner,`/api/returns/${body.return.id}/reverse`,{reason:"اتسجل غلط"});assert.equal(reversed.status,200);
    saved=JSON.parse(fs.readFileSync(path.join(temp,"data/database.json"),"utf8"));
    assert.equal(saved.books.find(b=>b.id==="B2").stock,5);assert.equal(saved.returns[0].status,"ملغى");assert.equal(saved.cash.length,2);
    console.log("PASS only owner, manager or accountant can reverse a return, and it is undone on the server");
  }finally{if(child){child.kill();await new Promise(r=>child.once("exit",r));}fs.rmSync(temp,{recursive:true,force:true});}
  console.log("All returns tests passed.");
})().catch(error=>{console.error(error);process.exitCode=1;});
