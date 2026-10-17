'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(50);}throw new Error('Timed out waiting for server');}
const legacy=(salt,password)=>crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'user-management-'));let child;
 try {
  fs.cpSync('app',path.join(temp,'app'),{recursive:true});fs.copyFileSync('server-node.js',path.join(temp,'server-node.js'));fs.mkdirSync(path.join(temp,'data'));
  const password='old-password';
  const users=[
   {id:'U001',username:'owner',name:'Owner',role:'مالك',active:true,salt:'s1',passwordHash:legacy('s1',password)},
   {id:'U002',username:'manager',name:'Manager',role:'مدير',active:true,salt:'s2',passwordHash:legacy('s2',password)},
   {id:'U003',username:'cashier',name:'Cashier',role:'كاشير',active:true,salt:'s3',passwordHash:legacy('s3',password)}
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
  const stored=username=>dbFile().users.find(u=>u.username===username);
  const api=async(token,method,route,body)=>{const r=await fetch(base+route,{method,headers:{'X-Session-Token':token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  const sessionOf=async token=>{const r=await fetch(base+'/api/session',{headers:{'X-Session-Token':token}});return r.status===200?(await r.json()).user:null;};
  const expectError=(result,status,code)=>{assert.equal(result.status,status,JSON.stringify(result.body));assert.equal(result.body.code,code,JSON.stringify(result.body));};

  const owner=await tokenFor('owner'),manager=await tokenFor('manager'),cashier=await tokenFor('cashier');
  const list=await api(owner,'GET','/api/admin/users');
  assert.equal(list.status,200,JSON.stringify(list.body));
  assert.deepEqual(list.body.users.map(u=>u.username),['owner','manager','cashier']);
  assert(list.body.users.every(u=>!('passwordHash' in u)&&!('salt' in u)&&!('passwordAlgorithm' in u)),'user list must not expose credentials');
  expectError(await api(cashier,'GET','/api/admin/users'),403,'PERMISSION_DENIED');
  expectError(await api(manager,'GET','/api/admin/users'),403,'PERMISSION_DENIED');
  expectError(await api(manager,'POST','/api/admin/users',{username:'x1',name:'X',role:'كاشير',password:'long-enough'}),403,'PERMISSION_DENIED');
  console.log('PASS only the owner can manage users by default, and the list has no credentials');

  expectError(await api(owner,'POST','/api/admin/users',{username:'a b',name:'Bad',role:'كاشير',password:'long-enough'}),400,'USERNAME_INVALID');
  expectError(await api(owner,'POST','/api/admin/users',{username:'Cashier',name:'Copy',role:'كاشير',password:'long-enough'}),409,'USERNAME_TAKEN');
  expectError(await api(owner,'POST','/api/admin/users',{username:'ahmed',name:'أحمد',role:'مدير عام',password:'long-enough'}),400,'ROLE_INVALID');
  expectError(await api(owner,'POST','/api/admin/users',{username:'ahmed',name:'',role:'كاشير',password:'long-enough'}),400,'NAME_INVALID');
  expectError(await api(owner,'POST','/api/admin/users',{username:'ahmed',name:'أحمد',role:'كاشير',password:'short'}),400,'PASSWORD_TOO_SHORT');
  const created=await api(owner,'POST','/api/admin/users',{username:' Ahmed.Sales ',name:' أحمد علي ',role:'كاشير',password:'temp-pass-1'});
  assert.equal(created.status,201,JSON.stringify(created.body));
  assert.deepEqual([created.body.user.id,created.body.user.username,created.body.user.name,created.body.user.role,created.body.user.active],['U004','ahmed.sales','أحمد علي','كاشير',true]);
  assert(!('passwordHash' in created.body.user)&&!('salt' in created.body.user));
  const ahmedRecord=stored('ahmed.sales');
  assert.equal(ahmedRecord.passwordAlgorithm,'scrypt');assert.equal(ahmedRecord.passwordTemporary,true);assert.equal(ahmedRecord.createdBy,'owner');assert(ahmedRecord.passwordChangedAt);
  assert(dbFile().audit.some(row=>row.operationType==='USER_CREATED'&&row.documentNo==='ahmed.sales'&&row.username==='owner'),'creation is audited');
  console.log('PASS owner creates a validated user with a scrypt password and an audit record');

  let ahmed=await tokenFor('Ahmed.Sales','temp-pass-1');
  assert.deepEqual(await sessionOf(ahmed),{id:'U004',username:'ahmed.sales',name:'أحمد علي',role:'كاشير'});
  const clientDb=await (await fetch(base+'/api/db',{headers:{'X-Session-Token':owner}})).json();
  clientDb.users=clientDb.users.filter(u=>u.username!=='ahmed.sales');clientDb.settings.companyName='Saved after user creation';
  const revision=String(dbFile().meta.dataRevision);
  const save=await fetch(base+'/api/db',{method:'PUT',headers:{'X-Session-Token':owner,'Content-Type':'application/json','If-Match':revision},body:JSON.stringify(clientDb)});
  assert.equal(save.status,200,await save.text());
  assert(stored('ahmed.sales'),'a client save cannot remove users');assert.equal(dbFile().settings.companyName,'Saved after user creation');
  console.log('PASS the new user logs in (username is case-insensitive) and client saves keep it');

  const edited=await api(owner,'PATCH','/api/admin/users/ahmed.sales',{name:'أحمد علي حسن',role:'مخزن'});
  assert.equal(edited.status,200,JSON.stringify(edited.body));
  assert.deepEqual([stored('ahmed.sales').name,stored('ahmed.sales').role],['أحمد علي حسن','مخزن']);
  assert.equal((await sessionOf(ahmed)).role,'مخزن','open sessions get the new role at once');
  const unchanged=await api(owner,'PATCH','/api/admin/users/ahmed.sales',{name:'أحمد علي حسن'});
  assert.equal(unchanged.body.unchanged,true);
  expectError(await api(owner,'PATCH','/api/admin/users/nobody',{name:'Nobody'}),404,'USER_NOT_FOUND');
  assert(dbFile().audit.some(row=>row.operationType==='USER_UPDATED'&&/كاشير ← مخزن/.test(row.notes)),'role change is audited');
  console.log('PASS editing name and role updates the record, open sessions and the audit log');

  const otherAhmed=await tokenFor('ahmed.sales','temp-pass-1');
  const disabled=await api(owner,'PATCH','/api/admin/users/ahmed.sales',{active:false});
  assert.equal(disabled.status,200,JSON.stringify(disabled.body));
  assert.equal(await sessionOf(ahmed),null,'disabling ends sessions');assert.equal(await sessionOf(otherAhmed),null);
  assert.equal((await login('ahmed.sales','temp-pass-1')).status,401,'disabled users cannot log in');
  assert.equal(stored('ahmed.sales').disabledBy,'owner');
  assert.equal((await api(owner,'PATCH','/api/admin/users/ahmed.sales',{active:true})).status,200);
  assert.equal(stored('ahmed.sales').disabledAt,undefined);
  ahmed=await tokenFor('ahmed.sales','temp-pass-1');
  assert(['USER_DISABLED','USER_ENABLED'].every(type=>dbFile().audit.some(row=>row.operationType===type)));
  console.log('PASS disabling signs the user out and blocks login; enabling restores it');

  for(let i=0;i<10;i++)assert.equal((await login('ahmed.sales','wrong-password')).status,401);
  assert.equal((await login('ahmed.sales','temp-pass-1')).status,429);
  expectError(await api(owner,'POST','/api/admin/users/ahmed.sales/password',{password:'short'}),400,'PASSWORD_TOO_SHORT');
  expectError(await api(owner,'POST','/api/admin/users/owner/password',{password:'self-reset-1'}),409,'USE_ACCOUNT_PASSWORD');
  const reset=await api(owner,'POST','/api/admin/users/ahmed.sales/password',{password:'reset-pass-2'});
  assert.equal(reset.status,200,JSON.stringify(reset.body));
  assert.equal(await sessionOf(ahmed),null,'password reset ends sessions');
  assert.equal((await login('ahmed.sales','temp-pass-1')).status,401,'old password stops working');
  ahmed=await tokenFor('ahmed.sales','reset-pass-2');
  assert.equal(stored('ahmed.sales').passwordTemporary,true);
  const own=await api(ahmed,'POST','/api/account/password',{currentPassword:'reset-pass-2',newPassword:'my-own-pass-3'});
  assert.equal(own.status,200,JSON.stringify(own.body));
  assert.equal(stored('ahmed.sales').passwordTemporary,undefined,'changing your own password clears the temporary flag');
  assert(dbFile().audit.some(row=>row.operationType==='USER_PASSWORD_RESET'&&row.documentNo==='ahmed.sales'));
  console.log('PASS password reset ends sessions, lifts the login lockout and is audited');

  expectError(await api(owner,'PATCH','/api/admin/users/owner',{active:false}),409,'CANNOT_DISABLE_SELF');
  expectError(await api(owner,'PATCH','/api/admin/users/owner',{role:'مدير'}),409,'BUILTIN_OWNER_ROLE');
  assert.equal((await api(owner,'POST','/api/admin/users',{username:'khaled',name:'Khaled',role:'مالك',password:'owner-pass-1'})).status,201);
  const khaled=await tokenFor('khaled','owner-pass-1');
  assert.equal((await api(khaled,'PATCH','/api/admin/users/owner',{active:false})).status,200,'a second owner can disable the shared owner account');
  assert.equal(await sessionOf(owner),null);assert.equal((await login('owner',password)).status,401);
  expectError(await api(khaled,'PATCH','/api/admin/users/khaled',{role:'مدير'}),409,'LAST_OWNER');
  expectError(await api(khaled,'PATCH','/api/admin/users/khaled',{active:false}),409,'CANNOT_DISABLE_SELF');
  assert.equal(stored('khaled').role,'مالك');
  console.log('PASS the last active owner can never be disabled or demoted');

  const ownerDb=await (await fetch(base+'/api/db',{headers:{'X-Session-Token':khaled}})).json();
  ownerDb.settings.permissions.users.manager={views:['dashboard','settings'],actions:['manage-users']};
  const grant=await fetch(base+'/api/db',{method:'PUT',headers:{'X-Session-Token':khaled,'Content-Type':'application/json','If-Match':String(dbFile().meta.dataRevision)},body:JSON.stringify(ownerDb)});
  assert.equal(grant.status,200,await grant.text());
  assert.equal((await api(manager,'GET','/api/admin/users')).status,200,'manage-users permission opens the user list');
  assert.equal((await api(manager,'POST','/api/admin/users',{username:'mona',name:'Mona',role:'شحن',password:'mona-pass-1'})).status,201);
  expectError(await api(manager,'POST','/api/admin/users',{username:'boss',name:'Boss',role:'مالك',password:'boss-pass-1'}),403,'OWNER_ONLY');
  expectError(await api(manager,'PATCH','/api/admin/users/mona',{role:'مالك'}),403,'OWNER_ONLY');
  expectError(await api(manager,'POST','/api/admin/users/khaled/password',{password:'stolen-pass-1'}),403,'OWNER_ONLY');
  expectError(await api(manager,'PATCH','/api/admin/users/khaled',{active:false}),403,'OWNER_ONLY');
  assert.equal((await api(manager,'PATCH','/api/admin/users/mona',{active:false})).status,200);
  console.log('PASS manage-users lets a non-owner manage staff accounts but never owner accounts');
 } finally {
  if(child)child.kill();
  fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
