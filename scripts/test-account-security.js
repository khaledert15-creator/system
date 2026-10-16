'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(50);}throw new Error('Timed out waiting for server');}
const legacy=(salt,password)=>crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'account-security-'));let child;
 try {
  fs.cpSync('app',path.join(temp,'app'),{recursive:true});fs.copyFileSync('server-node.js',path.join(temp,'server-node.js'));fs.mkdirSync(path.join(temp,'data'));
  const password='old-password';
  const users=[
   {id:'U1',username:'owner',name:'Owner',role:'مالك',active:true,salt:'s1',passwordHash:legacy('s1',password)},
   {id:'U2',username:'cashier',name:'Cashier',role:'كاشير',active:true,salt:'s2',passwordHash:legacy('s2',password)},
   {id:'U3',username:'manager',name:'Manager',role:'مدير',active:true,salt:'s3',passwordHash:legacy('s3',password)}
  ];
  fs.writeFileSync(path.join(temp,'data/database.json'),JSON.stringify({version:4,meta:{dataRevision:0},users,books:[],sales:[],settings:{tracking:{enabled:false},permissions:{roles:{},users:{}}},audit:[]}));
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const base=`http://127.0.0.1:${port}`;
  const env={...process.env,PORT:String(port),HOST:'127.0.0.1',TRACKING_RPA_ENABLED:'false'};delete env.FACTORY_RESET_EXECUTION_ENABLED;
  child=spawn(process.execPath,['server-node.js'],{cwd:temp,env,stdio:'ignore'});
  await until(async()=>{try{return (await fetch(base+'/api/health')).ok;}catch{return false;}});
  const login=(username,pw)=>fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:pw})});
  const tokenFor=async(username,pw=password)=>{const r=await login(username,pw);assert.equal(r.status,200,await r.clone().text());return (await r.json()).token;};
  const dbFile=()=>JSON.parse(fs.readFileSync(path.join(temp,'data/database.json'),'utf8'));

  const cashier=await tokenFor('cashier');
  const read=await fetch(base+'/api/db',{headers:{'X-Session-Token':cashier}});
  const db=await read.json();
  assert(db.users.every(u=>!('passwordHash' in u)&&!('salt' in u)),'GET /api/db must not expose credentials');
  console.log('PASS /api/db hides password hashes and salts');

  db.users.find(u=>u.username==='cashier').role='مالك';
  db.settings.companyName='Cashier save';
  let revision=read.headers.get('X-DB-Revision');
  let write=await fetch(base+'/api/db',{method:'PUT',headers:{'X-Session-Token':cashier,'Content-Type':'application/json','If-Match':revision},body:JSON.stringify(db)});
  assert.equal(write.status,200,await write.text());revision=write.headers.get('X-DB-Revision');
  const afterSave=dbFile();
  assert.equal(afterSave.users.find(u=>u.username==='cashier').role,'كاشير','client cannot change user roles');
  assert.equal(afterSave.users.find(u=>u.username==='owner').passwordHash,users[0].passwordHash,'credentials survive client saves');
  assert.equal(afterSave.settings.companyName,'Cashier save');
  console.log('PASS client saves keep server users and credentials unchanged');

  db.settings.permissions.users.cashier={views:['settings'],actions:['customize-user']};
  write=await fetch(base+'/api/db',{method:'PUT',headers:{'X-Session-Token':cashier,'Content-Type':'application/json','If-Match':revision},body:JSON.stringify(db)});
  assert.equal(write.status,403);assert.equal((await write.json()).code,'PERMISSIONS_CHANGE_FORBIDDEN');
  const manager=await tokenFor('manager');
  const managerDb=await (await fetch(base+'/api/db',{headers:{'X-Session-Token':manager}})).json();
  managerDb.settings.permissions.roles['كاشير']={views:['dashboard'],actions:[]};
  write=await fetch(base+'/api/db',{method:'PUT',headers:{'X-Session-Token':manager,'Content-Type':'application/json','If-Match':revision},body:JSON.stringify(managerDb)});
  assert.equal(write.status,200,await write.text());revision=write.headers.get('X-DB-Revision');
  console.log('PASS only permission managers can change role/user permissions');

  const change=(token,body)=>fetch(base+'/api/account/password',{method:'POST',headers:{'X-Session-Token':token,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await change(cashier,{currentPassword:'wrong',newPassword:'new-password-1'})).status,401);
  assert.equal((await change(cashier,{currentPassword:password,newPassword:'short'})).status,400);
  const otherSession=await tokenFor('cashier');
  const changed=await change(cashier,{currentPassword:password,newPassword:'new-password-1'});
  assert.equal(changed.status,200,await changed.clone().text());
  const stored=dbFile().users.find(u=>u.username==='cashier');
  assert.equal(stored.passwordAlgorithm,'scrypt');assert.notEqual(stored.passwordHash,users[1].passwordHash);
  assert.equal((await login('cashier',password)).status,401);
  await tokenFor('cashier','new-password-1');
  assert.equal((await fetch(base+'/api/session',{headers:{'X-Session-Token':otherSession}})).status,401,'other sessions are signed out');
  assert.equal((await fetch(base+'/api/session',{headers:{'X-Session-Token':cashier}})).status,200,'current session stays signed in');
  await tokenFor('owner');
  console.log('PASS password change stores scrypt hash, old password stops working, legacy users still log in');

  for(let i=0;i<10;i++)assert.equal((await login('manager','bad')).status,401);
  assert.equal((await login('manager',password)).status,429);
  console.log('PASS repeated failed logins are throttled');

  const season=await (await fetch(base+'/api/admin/season-data',{headers:{'X-Session-Token':await tokenFor('owner')}})).json();
  assert.equal(season.factoryResetEnabled,false);
  console.log('PASS factory reset execution is disabled by default');
 } finally {
  if(child)child.kill();
  fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
