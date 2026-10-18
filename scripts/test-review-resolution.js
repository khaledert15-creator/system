'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(50);}throw new Error('Timed out waiting for server');}
const now=new Date().toISOString();
// Like ORD-0076: stopped for review by another employee with the old flow (reason and note, no missing books).
const reviewOrder=id=>({id,customerId:'C1',customerName:'عميل',phone:'01000000000',governorate:'القاهرة',address:'QA',lines:[{bookId:'B1',qty:1,price:100},{bookId:'B2',qty:1,price:100}],total:200,paidAmount:0,
  status:'يحتاج مراجعة',workflowStage:'needs_review',confirmedAt:now,preparingBy:'مسؤول المخزن',preparingByUsername:'warehouse',
  preparationChecklist:[{bookId:'B1',qty:1,done:true},{bookId:'B2',qty:1,done:true}],preparationIssue:{reason:'صنف غير متوفر',notes:'كتاب ب مش موجود',createdAt:now,createdBy:'مسؤول المخزن'},
  inventoryReservation:{id:`RSV-${id}`,status:'active',lines:[{bookId:'B1',qty:1},{bookId:'B2',qty:1}]}});
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'review-resolution-'));let child;
 try {
  fs.cpSync('app',path.join(temp,'app'),{recursive:true});fs.copyFileSync('server-node.js',path.join(temp,'server-node.js'));fs.mkdirSync(path.join(temp,'data'));
  const salt='s',password='test-password',dbFile=path.join(temp,'data/database.json');
  fs.writeFileSync(dbFile,JSON.stringify({version:4,meta:{dataRevision:0},users:[{id:'U1',username:'owner',name:'Owner',role:'مالك',active:true,salt,passwordHash:crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')}],
   settings:{tracking:{enabled:false}},audit:[],sales:[],books:[{id:'B1',name:'كتاب أ',stock:5,reservedStock:2,price:100},{id:'B2',name:'كتاب ب',stock:3,reservedStock:2,price:100}],
   customers:[{id:'C1',name:'عميل',phone:'01000000000'}],onlineOrders:[reviewOrder('ORD1'),reviewOrder('ORD2')]}));
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['server-node.js'],{cwd:temp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TRACKING_RPA_ENABLED:'false'},stdio:'ignore'});
  await until(async()=>{try{return (await fetch(base+'/api/health')).ok;}catch{return false;}});
  const token=(await (await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password})})).json()).token;
  const post=(url,body)=>fetch(base+url,{method:'POST',headers:{'X-Session-Token':token,'Content-Type':'application/json'},body:JSON.stringify(body||{})});
  const order=id=>JSON.parse(fs.readFileSync(dbFile,'utf8')).onlineOrders.find(o=>o.id===id);

  let r=await post('/api/orders/ORD1/prepare/complete',{packedWeightGrams:900});
  assert.equal(r.status,409);let body=await r.json();
  assert.equal(body.code,'ORDER_UNDER_REVIEW');assert.match(body.message,/صنف غير متوفر/);assert.match(body.message,/استئناف التجهيز/);
  console.log('PASS completing an order under review explains what to do');

  r=await post('/api/orders/ORD1/prepare/start');
  assert.equal(r.status,200,await r.clone().text());
  const resumed=order('ORD1');
  assert.equal(resumed.workflowStage,'preparing');assert.equal(resumed.preparingByUsername,'owner','the reviewer takes over');
  assert.equal(resumed.preparationIssue,undefined);assert.equal(resumed.preparationIssueHistory[0].notes,'كتاب ب مش موجود');
  console.log('PASS another employee can resume an order stopped for review; the issue moves to history');

  r=await post('/api/orders/ORD2/prepare/issue',{reason:'صنف غير متوفر',notes:'كتاب ب مش موجود',missingLines:[{bookId:'B2',qty:1}]});
  assert.equal(r.status,200,await r.clone().text());
  assert.equal(order('ORD2').workflowStage,'awaiting_stock');assert.deepEqual(order('ORD2').backorderLines,[{bookId:'B2',qty:1}]);
  r=await post('/api/orders/ORD2/prepare/complete',{packedWeightGrams:900});
  assert.equal(r.status,409);assert.equal((await r.json()).code,'ORDER_AWAITING_STOCK');
  console.log('PASS an order under review can move its missing book to pre-order');
 } finally {
  if(child)child.kill();
  fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
