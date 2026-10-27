'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(50);}throw new Error('Timed out waiting for server');}
const now=new Date().toISOString();
const order=(id,extra={})=>({id,customerId:'C1',customerName:'عميل',phone:'01000000000',governorate:'القاهرة',lines:[{bookId:'B1',qty:2,price:150}],total:300,paidAmount:0,status:'تم التجهيز',workflowStage:'awaiting_shipping',preparedAt:now,createdAt:now,...extra});
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'order-cancel-complete-'));let child;
 try {
  fs.cpSync('app',path.join(temp,'app'),{recursive:true});fs.copyFileSync('server-node.js',path.join(temp,'server-node.js'));fs.mkdirSync(path.join(temp,'data'));
  const salt='s',password='test-password';
  const db={version:4,meta:{dataRevision:0},
   users:[{id:'U1',username:'owner',name:'Owner',role:'مالك',active:true,salt,passwordHash:crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')}],
   settings:{tracking:{enabled:false}},audit:[],
   books:[{id:'B1',name:'كتاب',stock:8,reservedStock:2}],
   customers:[{id:'C1',name:'عميل',balance:200}],
   cashAccounts:[{id:'CA1',name:'الخزنة',active:true}],
   sales:[{id:'INV1',onlineOrderId:'ORD1',customerId:'C1',lines:[{bookId:'B1',qty:2,price:150}],total:300,paid:100,remaining:200,status:'معتمدة',date:now,createdAt:now}],
   orderPayments:[{id:'PAY1',orderId:'ORD1',invoiceId:'INV1',customerId:'C1',amount:100,cashAccountId:'CA1',cashAccountName:'الخزنة',status:'confirmed',receivedAt:now}],
   shipments:[
    {id:'SH2',onlineOrderId:'ORD2',carrier:'البريد المصري',trackingNumber:'EN111EG',normalizedStatus:'shipped',status:'تم التجهيز',createdAt:now},
    {id:'SH3',onlineOrderId:'ORD3',carrier:'البريد المصري',trackingNumber:'EN222EG',normalizedStatus:'in_transit',status:'في الطريق',createdAt:now}],
   onlineOrders:[
    order('ORD1',{saleId:'INV1',paidAmount:100,inventoryReservation:{status:'consumed',lines:[{bookId:'B1',qty:2}]}}),
    order('ORD2',{shipmentId:'SH2',workflowStage:'shipped',status:'تم الشحن',inventoryReservation:{status:'active',lines:[{bookId:'B1',qty:2}]}}),
    order('ORD3',{shipmentId:'SH3',workflowStage:'shipped',status:'تم الشحن'}),
    order('ORD5',{saleId:'INV5',status:'تم التجهيز'})]};
  // An invoice already returned (its books went back with the return): neither the order nor the invoice may be cancelled.
  db.sales.push({id:'INV5',onlineOrderId:'ORD5',customerId:'C1',lines:[{bookId:'B1',qty:1,price:150}],total:150,paid:0,remaining:0,status:'مرتجع جزئي',date:now,createdAt:now});
  db.returns=[{id:'RET-0001',returnNo:'SR-1001',type:'sales_return',documentId:'INV5',sourceDocuments:['INV5'],items:[{bookId:'B1',qty:1,lineIndex:0}],status:'معتمد'}];
  fs.writeFileSync(path.join(temp,'data/database.json'),JSON.stringify(db));
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['server-node.js'],{cwd:temp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TRACKING_RPA_ENABLED:'false'},stdio:'ignore'});
  await until(async()=>{try{return (await fetch(base+'/api/health')).ok;}catch{return false;}});
  const token=(await (await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password})})).json()).token;
  const cancel=(id,body)=>fetch(`${base}/api/orders/${id}/cancel-complete`,{method:'POST',headers:{'X-Session-Token':token,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const read=()=>JSON.parse(fs.readFileSync(path.join(temp,'data/database.json'),'utf8'));

  assert.equal((await cancel('ORD1',{operationKey:'k0'})).status,400);
  console.log('PASS cancellation reason is required');

  let response=await cancel('ORD1',{reason:'العميل ألغى الطلب',refundAmount:60,cashAccountId:'CA1',operationKey:'k1'});
  assert.equal(response.status,200,await response.clone().text());
  let after=read();
  assert.equal(after.onlineOrders.find(o=>o.id==='ORD1').workflowStage,'cancelled');
  assert.equal(after.sales.find(s=>s.id==='INV1').status,'ملغاة');
  assert.equal(after.books[0].stock,10,'invoice void returns stock');
  const refunds=after.orderRefunds.filter(r=>r.orderId==='ORD1');
  assert.deepEqual(refunds.map(r=>[r.settlementType,r.amount]).sort(),[['cash_refund',60],['customer_credit',40]]);
  assert(after.cash.some(t=>t.direction==='out'&&t.amount===60&&t.accountId==='CA1'),'cash refund recorded on the chosen account');
  assert(after.customerCredits.some(c=>c.customerId==='C1'&&c.amount===40),'remainder becomes customer credit');
  console.log('PASS ready-to-ship order with invoice and payment cancels in one step (partial cash refund, rest as credit)');

  response=await cancel('ORD1',{reason:'العميل ألغى الطلب',refundAmount:60,cashAccountId:'CA1',operationKey:'k1'});
  assert.equal(response.status,200);assert.equal((await response.json()).existing,true);
  assert.equal(read().orderRefunds.length,2,'repeat does not refund twice');
  console.log('PASS repeating the request is safe');

  response=await cancel('ORD2',{reason:'طلب مكرر',operationKey:'k2'});
  assert.equal(response.status,409);assert.equal((await response.json()).code,'CARRIER_CANCELLATION_CONFIRMATION_REQUIRED');
  assert.equal(read().onlineOrders.find(o=>o.id==='ORD2').workflowStage,'shipped','failed attempt changes nothing');
  response=await cancel('ORD2',{reason:'طلب مكرر',carrierCancelled:true,operationKey:'k2'});
  assert.equal(response.status,200,await response.clone().text());
  after=read();
  assert.equal(after.shipments.find(s=>s.id==='SH2').normalizedStatus,'cancelled');
  assert.equal(after.shipments.find(s=>s.id==='SH2').postalChargeStatus,'charged');
  assert.equal(after.onlineOrders.find(o=>o.id==='ORD2').workflowStage,'cancelled');
  assert.equal(after.books[0].reservedStock,0,'reservation released');
  console.log('PASS registered but not handed-over shipment is cancelled with the order');

  response=await cancel('ORD3',{reason:'العميل ألغى الطلب',carrierCancelled:true,operationKey:'k3'});
  assert.equal(response.status,409);assert.equal((await response.json()).code,'SHIPMENT_WITH_CARRIER');
  console.log('PASS orders already with the carrier must go through returns');

  // The post shows the code moving, but the employee confirms the courier never collected the parcel.
  response=await cancel('ORD3',{reason:'العميل ألغى الطلب',carrierCancelled:true,courierNotPickedUp:true,postalChargeStatus:'not_charged',operationKey:'k4'});
  assert.equal(response.status,200,await response.clone().text());
  const afterPickup=JSON.parse(fs.readFileSync(path.join(temp,'data/database.json'),'utf8'));
  const sh3=afterPickup.shipments.find(item=>item.id==='SH3');
  assert.equal(sh3.normalizedStatus,'cancelled');assert.equal(sh3.courierNotPickedUp,true);assert.equal(sh3.postalChargeStatus,'not_charged');
  assert.equal(afterPickup.onlineOrders.find(item=>item.id==='ORD3').status,'ملغي');
  console.log('PASS a parcel the courier never collected can be cancelled even when tracking shows it moving');

  const stockBefore=JSON.parse(fs.readFileSync(path.join(temp,'data/database.json'),'utf8')).books[0].stock;
  response=await cancel('ORD5',{reason:'العميل ألغى الطلب',operationKey:'k5'});
  assert.equal(response.status,409);assert.equal((await response.json()).code,'SALE_HAS_RETURN');
  response=await fetch(`${base}/api/sales/INV5/cancel`,{method:'POST',headers:{'X-Session-Token':token,'Content-Type':'application/json'},body:JSON.stringify({reason:'خطأ',operationKey:'k6'})});
  assert.equal(response.status,409);assert.equal((await response.json()).code,'SALE_HAS_RETURN');
  assert.equal(JSON.parse(fs.readFileSync(path.join(temp,'data/database.json'),'utf8')).books[0].stock,stockBefore,'stock untouched');
  console.log('PASS an invoice with a return cannot be cancelled (would restock twice)');
 } finally {
  if(child)child.kill();
  fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
