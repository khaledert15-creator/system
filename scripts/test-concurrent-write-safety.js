'use strict';
// Regression: a request whose body arrives late must not overwrite a save that landed meanwhile (lost update).
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),http=require('node:http'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(50);}throw new Error('Timed out waiting for server');}
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'concurrent-write-'));let child;
 try {
  fs.cpSync('app',path.join(temp,'app'),{recursive:true});fs.copyFileSync('server-node.js',path.join(temp,'server-node.js'));fs.mkdirSync(path.join(temp,'data'));
  const salt='s',password='test-password',dbFile=path.join(temp,'data/database.json');
  fs.writeFileSync(dbFile,JSON.stringify({version:4,meta:{dataRevision:0},
   users:[{id:'U1',username:'owner',name:'Owner',role:'مالك',active:true,salt,passwordHash:crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')}],
   settings:{tracking:{enabled:false}},audit:[],sales:[],onlineOrders:[],customers:[],
   shippingCompanies:[{id:'SC-001',name:'البريد المصري',active:true}],
   books:[{id:'B1',name:'كتاب',stock:5,reservedStock:0,price:100}]}));
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['server-node.js'],{cwd:temp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TRACKING_RPA_ENABLED:'false'},stdio:'ignore'});
  await until(async()=>{try{return (await fetch(base+'/api/health')).ok;}catch{return false;}});
  const token=(await (await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password})})).json()).token;
  const payload=(phone,name)=>JSON.stringify({phone,customerName:name,governorate:'القاهرة',address:'شارع الاختبار',lines:[{bookId:'B1',qty:1}],shippingCost:0});

  // Request A sends its headers now and its body 300ms later (a slow mobile upload).
  const slow=new Promise((resolve,reject)=>{
   const body=payload('01012345601','عميل بطيء');
   const req=http.request(base+'/api/orders/quick',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'X-Session-Token':token}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text||'{}')}));});
   req.on('error',reject);req.flushHeaders();setTimeout(()=>req.end(body),300);
  });
  await sleep(50);
  // Request B completes while A is still uploading.
  const fastResponse=await fetch(base+'/api/orders/quick',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':token},body:payload('01012345602','عميل سريع')});
  const fast={status:fastResponse.status,body:await fastResponse.json()};
  const late=await slow;
  assert.equal(fast.status,201,JSON.stringify(fast.body));
  assert.equal(late.status,201,JSON.stringify(late.body));
  assert.notEqual(late.body.order.id,fast.body.order.id,'each order gets its own id');
  const db=JSON.parse(fs.readFileSync(dbFile,'utf8'));
  assert.deepEqual(db.onlineOrders.map(order=>order.id).sort(),[fast.body.order.id,late.body.order.id].sort(),'both orders are stored');
  assert.deepEqual(db.customers.map(customer=>customer.phone).sort(),['01012345601','01012345602'],'both new customers are stored');
  assert.notEqual(db.customers[0].id,db.customers[1].id,'customers keep distinct ids');
  console.log('PASS a late request body does not overwrite an order saved meanwhile');
  console.log('PASS concurrent write safety checks completed');
 } finally {
  if(child)child.kill();
  fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
