'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(50);}throw new Error('Timed out waiting for server');}
const now=new Date().toISOString();
const draft=(id,lines)=>({id,customerId:'C1',customerName:'عميل',phone:'01000000000',governorate:'القاهرة',address:'QA',lines,total:500,paidAmount:0,status:'مسودة',workflowStage:'draft',createdAt:now});
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'order-backorder-'));let child,port;
 const start=async()=>{child=spawn(process.execPath,['server-node.js'],{cwd:temp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TRACKING_RPA_ENABLED:'false'},stdio:'ignore'});await until(async()=>{try{return (await fetch(`http://127.0.0.1:${port}/api/health`)).ok;}catch{return false;}});};
 try {
  fs.cpSync('app',path.join(temp,'app'),{recursive:true});fs.copyFileSync('server-node.js',path.join(temp,'server-node.js'));fs.mkdirSync(path.join(temp,'data'));
  const salt='s',password='test-password';
  const dbFile=path.join(temp,'data/database.json');
  // B2 has 1 copy. ORD1 needs B1×2 + B2×3 (cannot ship), ORD2 needs B2×1 (can ship).
  fs.writeFileSync(dbFile,JSON.stringify({version:4,meta:{dataRevision:0},
   users:[{id:'U1',username:'owner',name:'Owner',role:'مالك',active:true,salt,passwordHash:crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')}],
   settings:{tracking:{enabled:false}},audit:[],sales:[],
   books:[{id:'B1',name:'متوفر',stock:5,reservedStock:0,price:100},{id:'B2',name:'ناقص',stock:1,reservedStock:0,price:100}],
   customers:[{id:'C1',name:'عميل',phone:'01000000000',governorate:'القاهرة',address:'QA'}],
   onlineOrders:[draft('ORD1',[{bookId:'B1',qty:2,price:100},{bookId:'B2',qty:3,price:100}]),draft('ORD2',[{bookId:'B2',qty:1,price:100}])]}));
  port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const base=`http://127.0.0.1:${port}`;
  await start();
  const login=async()=>(await (await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password})})).json()).token;
  let token=await login();
  const post=(url,body)=>fetch(base+url,{method:'POST',headers:{'X-Session-Token':token,'Content-Type':'application/json'},body:JSON.stringify(body||{})});
  const read=()=>JSON.parse(fs.readFileSync(dbFile,'utf8'));
  const order=id=>read().onlineOrders.find(o=>o.id===id);
  const book=id=>read().books.find(b=>b.id===id);

  let r=await post('/api/orders/ORD1/confirm');
  assert.equal(r.status,200,await r.clone().text());
  assert.equal(order('ORD1').workflowStage,'awaiting_stock');
  assert.deepEqual(order('ORD1').backorderLines,[{bookId:'B2',qty:2}],'only the missing books are listed');
  assert.equal(book('B1').reservedStock,0);assert.equal(book('B2').reservedStock,0,'a pre-order holds no copies');
  assert.equal(order('ORD1').inventoryReservation.status,'released');
  console.log('PASS confirming with a shortage makes a pre-order that holds no copies');

  r=await post('/api/orders/ORD2/confirm');
  assert.equal(r.status,200);
  assert.equal(order('ORD2').workflowStage,'awaiting_preparation','a newer order that can ship complete gets the free copy');
  assert.equal(book('B2').reservedStock,1);
  console.log('PASS the free copy goes to an order that can ship complete');

  r=await post('/api/orders/ORD1/prepare/start');
  assert.notEqual(r.status,200,'pre-order cannot enter preparation');
  r=await post('/api/orders/ORD1/backorder/allocate');
  assert.equal(r.status,409);const manual=await r.json();assert.equal(manual.code,'NO_STOCK_AVAILABLE');assert.match(manual.message,/ناقص × 3/);
  console.log('PASS waiting orders stay out of preparation; the manual check lists what is missing');

  // Stock arrives (server restarts with more copies): the waiting order moves once every book is free.
  child.kill();await sleep(300);
  const db=read();db.books.find(b=>b.id==='B2').stock=3;fs.writeFileSync(dbFile,JSON.stringify(db));
  await start();token=await login();await sleep(3500);
  assert.equal(order('ORD1').workflowStage,'awaiting_stock','2 free copies are not enough for 3');
  assert.deepEqual(order('ORD1').backorderLines,[{bookId:'B2',qty:1}],'the missing list follows current stock');
  assert.equal(book('B2').reservedStock,1,'still no partial hold');
  const currentResponse=await fetch(base+'/api/db',{headers:{'X-Session-Token':token}}),current=await currentResponse.json();
  current.books.find(b=>b.id==='B2').stock=4;
  r=await fetch(base+'/api/db',{method:'PUT',headers:{'X-Session-Token':token,'Content-Type':'application/json','If-Match':currentResponse.headers.get('x-db-revision')},body:JSON.stringify(current)});
  assert.equal(r.status,200,await r.clone().text());
  await until(async()=>order('ORD1').workflowStage==='awaiting_preparation');
  assert.equal(order('ORD1').carriedOverFromBackorder,true,'carried-over orders are flagged');
  assert.equal(book('B1').reservedStock,2);assert.equal(book('B2').reservedStock,4);
  assert(read().notifications.some(n=>n.key==='backorder-ready:ORD1'),'staff are notified');
  console.log('PASS a save that adds stock moves the pre-order once all its books are free');

  r=await post('/api/orders/ORD1/prepare/start');
  assert.equal(r.status,200,await r.clone().text());
  console.log('PASS completed pre-order enters the preparation queue');
 } finally {
  if(child)child.kill();
  fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
