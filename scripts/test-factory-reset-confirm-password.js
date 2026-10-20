'use strict';
// The first factory-reset confirmation needs the owner's current password. Execute is never called here.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(50);}throw new Error('Timed out waiting for server');}
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'factory-reset-confirm-'));let child,output='';
 try {
  fs.cpSync('app',path.join(temp,'app'),{recursive:true});fs.copyFileSync('server-node.js',path.join(temp,'server-node.js'));fs.mkdirSync(path.join(temp,'data'));
  const password=`owner-${crypto.randomUUID()}`,dbFile=path.join(temp,'data/database.json');
  const user=(id,username,role)=>{const salt=`salt-${id}`;return {id,username,name:username,role,active:true,salt,passwordHash:crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')};};
  fs.writeFileSync(dbFile,JSON.stringify({version:4,meta:{dataRevision:5},users:[user('U1','owner','مالك'),user('U2','manager','مدير'),user('U3','cashier','كاشير')],
   settings:{tracking:{enabled:false}},audit:[],sales:[{id:'INV-1',lines:[]}],books:[{id:'B1',name:'كتاب',stock:1}],customers:[{id:'C1',name:'عميل'}]}));
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['server-node.js'],{cwd:temp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TRACKING_RPA_ENABLED:'false',FACTORY_RESET_EXECUTION_ENABLED:'true'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  await until(async()=>{try{return (await fetch(base+'/api/health')).ok;}catch{return false;}});
  const login=async username=>(await (await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})})).json()).token;
  const owner=await login('owner'),manager=await login('manager'),cashier=await login('cashier');
  const post=(route,token,body)=>fetch(base+route,{method:'POST',headers:{'X-Session-Token':token,'Content-Type':'application/json'},body:JSON.stringify(body)});

  let r=await post('/api/admin/factory-reset/prepare',owner,{resetType:'business'});
  assert.equal(r.status,201,await r.clone().text());
  const {preparationId}=await r.json();
  const confirm=(token,extra={})=>post('/api/admin/factory-reset/confirm',token,{resetType:'business',preparationId,currentUsername:'owner',operationKey:'RESET-QA-1',...extra});

  for(const token of [manager,cashier]){
   r=await confirm(token,{password});
   assert.equal(r.status,403,'only the owner role can confirm');assert.equal((await r.json()).code,'PERMISSION_DENIED');
  }
  console.log('PASS non-owner roles cannot confirm a factory reset');
  r=await confirm(owner);
  assert.equal(r.status,401);assert.equal((await r.json()).code,'OWNER_PASSWORD_REQUIRED');
  r=await confirm(owner,{password:'wrong-password'});
  assert.equal(r.status,401);assert.equal((await r.json()).code,'OWNER_PASSWORD_REQUIRED');
  console.log('PASS confirm without the password or with a wrong password is refused (401)');
  r=await confirm(owner,{password});
  assert.equal(r.status,200,await r.clone().text());
  const confirmed=await r.json();
  assert.equal(confirmed.confirmed,true);assert.ok(confirmed.executeAfter>Date.now()-1000);
  console.log('PASS the owner with the correct password reaches the final countdown');

  const db=JSON.parse(fs.readFileSync(dbFile,'utf8'));
  assert.equal(db.meta.dataRevision,5,'confirming does not change data');assert.equal(db.sales.length,1);
  await sleep(100);
  assert.equal(output.includes(password),false,'the password is never logged');
  assert.equal(output.includes('wrong-password'),false,'a wrong password is never logged');
  console.log('PASS factory reset confirm password checks completed');
 } finally {
  if(child)child.kill();
  fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
