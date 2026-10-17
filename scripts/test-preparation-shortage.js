'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(50);}throw new Error('Timed out waiting for server');}
const now=new Date().toISOString();
const confirmed=(id,lines,reserved)=>({id,customerId:'C1',customerName:'عميل',phone:'01000000000',governorate:'القاهرة',address:'QA',lines,total:300,paidAmount:0,status:'قيد التجهيز',workflowStage:'preparing',confirmedAt:now,preparingBy:'مخزن',preparingByUsername:'owner',inventoryReservation:{id:`RSV-${id}`,status:'active',lines:reserved}});
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prep-shortage-'));let child;
 try {
  fs.cpSync('app',path.join(temp,'app'),{recursive:true});fs.copyFileSync('server-node.js',path.join(temp,'server-node.js'));fs.mkdirSync(path.join(temp,'data'));
  const salt='s',password='test-password',dbFile=path.join(temp,'data/database.json');
  fs.writeFileSync(dbFile,JSON.stringify({version:4,meta:{dataRevision:0},
   users:[{id:'U1',username:'owner',name:'Owner',role:'مالك',active:true,salt,passwordHash:crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')}],
   settings:{tracking:{enabled:false}},audit:[],sales:[],
   books:[{id:'B1',name:'كتاب أ',stock:5,reservedStock:3,price:100},{id:'B2',name:'كتاب ب',stock:4,reservedStock:1,price:100}],
   customers:[{id:'C1',name:'عميل',phone:'01000000000'}],
   onlineOrders:[confirmed('ORD1',[{bookId:'B1',qty:3,price:100},{bookId:'B2',qty:1,price:100}],[{bookId:'B1',qty:3},{bookId:'B2',qty:1}]),
     {...confirmed('ORD2',[{bookId:'B1',qty:3,price:100}],[]),workflowStage:'draft',status:'مسودة',confirmedAt:null,inventoryReservation:null}]}));
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['server-node.js'],{cwd:temp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TRACKING_RPA_ENABLED:'false'},stdio:'ignore'});
  await until(async()=>{try{return (await fetch(base+'/api/health')).ok;}catch{return false;}});
  const token=(await (await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password})})).json()).token;
  const post=(url,body)=>fetch(base+url,{method:'POST',headers:{'X-Session-Token':token,'Content-Type':'application/json'},body:JSON.stringify(body||{})});
  const read=()=>JSON.parse(fs.readFileSync(dbFile,'utf8'));
  const order=id=>read().onlineOrders.find(o=>o.id===id),book=id=>read().books.find(b=>b.id===id);

  let r=await post('/api/orders/ORD1/prepare/issue',{reason:'صنف غير متوفر',notes:'الرف فاضي'});
  assert.equal(r.status,400);assert.equal((await r.json()).code,'MISSING_BOOKS_REQUIRED');
  console.log('PASS a shortage reason requires the missing books');

  r=await post('/api/orders/ORD1/prepare/issue',{reason:'صنف غير متوفر',notes:'الرف فاضي',missingLines:[{bookId:'B1',qty:2}]});
  assert.equal(r.status,200,await r.clone().text());
  const o=order('ORD1');
  assert.equal(o.workflowStage,'awaiting_stock');assert.equal(o.status,'حجز مسبق');
  assert.deepEqual(o.backorderLines,[{bookId:'B1',qty:2}]);
  assert.equal(o.preparationIssue.notes,'الرف فاضي');assert.deepEqual(o.preparationIssue.missingLines,[{bookId:'B1',qty:2}]);
  assert.equal(o.preparingByUsername,null,'preparation lock is released');
  assert.equal(book('B1').reservedStock,1,'missing copies are released from the reservation');
  assert.equal(book('B1').countHoldQty,2,'missing copies are held for a stock count');
  assert.equal(book('B2').reservedStock,1,'other books in the order stay reserved');
  console.log('PASS reporting missing books moves the order to pre-order and keeps the note');

  r=await post('/api/orders/ORD2/confirm');
  assert.equal(r.status,200);
  assert.equal(order('ORD2').workflowStage,'awaiting_stock','held copies are not sold to another order');
  assert.deepEqual(order('ORD2').backorderLines,[{bookId:'B1',qty:1}],'only stock minus reservations minus held copies is available');
  console.log('PASS copies waiting for a count are not available to other orders');

  // A stock count (client save) that clears the hold makes the copies available again.
  const db=await (await fetch(base+'/api/db',{headers:{'X-Session-Token':token}})).json();
  const b1=db.books.find(b=>b.id==='B1');b1.countHoldQty=0;
  r=await fetch(base+'/api/db',{method:'PUT',headers:{'X-Session-Token':token,'Content-Type':'application/json'},body:JSON.stringify(db)});
  assert.equal(r.status,200,await r.clone().text());
  r=await post('/api/orders/ORD1/backorder/allocate');
  assert.equal(r.status,200,await r.clone().text());
  assert.equal(order('ORD1').workflowStage,'awaiting_preparation');
  assert.equal(order('ORD1').preparationIssue,undefined);assert.equal(order('ORD1').preparationIssueHistory.length,1);
  console.log('PASS after the count the order can be completed and the issue moves to history');

  r=await post('/api/orders/ORD2/prepare/issue',{reason:'يحتاج مراجعة خدمة العملاء',notes:'العميل غيّر العنوان'});
  assert.equal(r.status,409,'issue cannot be reported on an order that is not in preparation');
 } finally {
  if(child)child.kill();
  fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
