'use strict';
// A whole-database save must never sell a copy reserved for a confirmed order (or held for a stock count), while the
// legacy "convert order to invoice" save that consumes that order's own reservation keeps working.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(50);}throw new Error('Timed out waiting for server');}
const now=new Date().toISOString();
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'reserved-stock-sale-'));let child;
 try {
  fs.cpSync('app',path.join(temp,'app'),{recursive:true});fs.copyFileSync('server-node.js',path.join(temp,'server-node.js'));fs.mkdirSync(path.join(temp,'data'));
  const salt='s',password='test-password',dbFile=path.join(temp,'data/database.json');
  fs.writeFileSync(dbFile,JSON.stringify({version:4,meta:{dataRevision:0},
   users:[{id:'U1',username:'owner',name:'Owner',role:'مالك',active:true,salt,passwordHash:crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')}],
   settings:{tracking:{enabled:false}},audit:[],sales:[],stockMovements:[],
   customers:[{id:'C1',name:'عميل',phone:'01000000000',governorate:'القاهرة',address:'QA'}],
   books:[{id:'B1',name:'نسخة وحيدة',stock:1,reservedStock:0,price:100},{id:'B2',name:'نسخة بانتظار الجرد',stock:2,reservedStock:0,countHoldQty:1,price:100}],
   onlineOrders:[{id:'ORD1',customerId:'C1',customerName:'عميل',phone:'01000000000',governorate:'القاهرة',address:'QA',lines:[{bookId:'B1',qty:1,price:100}],total:100,paidAmount:0,status:'مسودة',workflowStage:'draft',createdAt:now}]}));
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['server-node.js'],{cwd:temp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TRACKING_RPA_ENABLED:'false'},stdio:'ignore'});
  await until(async()=>{try{return (await fetch(base+'/api/health')).ok;}catch{return false;}});
  const token=(await (await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password})})).json()).token;
  const read=()=>JSON.parse(fs.readFileSync(dbFile,'utf8'));
  const latest=async()=>{const response=await fetch(base+'/api/db',{headers:{'X-Session-Token':token}});return {db:await response.json(),revision:response.headers.get('x-db-revision')};};
  const save=(db,revision)=>fetch(base+'/api/db',{method:'PUT',headers:{'X-Session-Token':token,'Content-Type':'application/json','If-Match':revision},body:JSON.stringify(db)});
  // Sets a book's stock the way the page does: with the movement that explains the change.
  const setStock=(db,bookId,after,documentId)=>{const book=db.books.find(b=>b.id===bookId);db.stockMovements.push({id:`MOV-${documentId}`,bookId,type:'بيع',quantity:after-book.stock,before:book.stock,after,documentId});book.stock=after;};
  const sale=(id,bookId,qty,extra={})=>({id,date:now.slice(0,10),customerId:'C1',status:'معتمدة',lines:[{bookId,productId:bookId,qty,quantity:qty,price:100}],subtotal:100*qty,total:100*qty,paid:100*qty,remaining:0,createdAt:now,...extra});

  let r=await fetch(base+'/api/orders/ORD1/confirm',{method:'POST',headers:{'X-Session-Token':token}});
  assert.equal(r.status,200,await r.clone().text());
  assert.equal(read().books.find(b=>b.id==='B1').reservedStock,1,'the confirmed order reserves the only copy');

  // POS sale of the reserved copy, stock deducted as the client does.
  let {db,revision}=await latest();
  db.sales.push(sale('INV-POS-1','B1',1));db.books.find(b=>b.id==='B1').stock=0;
  r=await save(db,revision);
  assert.equal(r.status,409,await r.clone().text());
  console.log('PASS a POS sale of a copy reserved for a confirmed order is refused (409)');

  // Same sale from a client that did not deduct stock: only the new reserved-stock rule can catch it. The owner's
  // negative-stock permission does not unlock reserved copies.
  ({db,revision}=await latest());
  db.settings.allowNegativeStock=true;db.sales.push(sale('INV-POS-2','B1',1));
  r=await save(db,revision);
  assert.equal(r.status,409,await r.clone().text());assert.equal((await r.json()).code,'RESERVED_STOCK_UNAVAILABLE');
  assert.equal(read().sales.length,0,'nothing was sold');
  console.log('PASS reserved copies stay unavailable even with the negative-stock override');

  // A copy reported missing during packing (countHoldQty) is not sellable until a stock count clears it.
  ({db,revision}=await latest());
  db.sales.push(sale('INV-POS-3','B2',2));db.books.find(b=>b.id==='B2').stock=0;
  r=await save(db,revision);
  assert.equal(r.status,409,await r.clone().text());assert.equal((await r.json()).code,'RESERVED_STOCK_UNAVAILABLE');
  ({db,revision}=await latest());
  db.sales.push(sale('INV-POS-4','B2',1));setStock(db,'B2',1,'INV-POS-4');
  r=await save(db,revision);
  assert.equal(r.status,200,await r.clone().text());
  console.log('PASS held copies are not sold; the free copy still is');

  // Legacy client path: convert the confirmed order itself into an invoice. Its own reservation is consumed.
  ({db,revision}=await latest());
  const order=db.onlineOrders.find(o=>o.id==='ORD1');
  db.sales.push(sale('INV-ORD1','B1',1,{onlineOrderId:'ORD1',operationKey:'order-invoice:ORD1',channel:'متجر إلكتروني'}));
  setStock(db,'B1',0,'INV-ORD1');Object.assign(order,{saleId:'INV-ORD1',status:'تم إنشاء الفاتورة'});
  r=await save(db,revision);
  assert.equal(r.status,200,await r.clone().text());
  const after=read();
  assert.equal(after.books.find(b=>b.id==='B1').stock,0);
  assert.equal(after.books.find(b=>b.id==='B1').reservedStock,0,'the order reservation is consumed by its own invoice');
  assert.equal(after.onlineOrders.find(o=>o.id==='ORD1').inventoryReservation.status,'consumed');
  console.log('PASS converting the order that holds the reservation into an invoice is allowed');
  console.log('PASS reserved stock sale guard checks completed');
 } finally {
  if(child)child.kill();
  fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
