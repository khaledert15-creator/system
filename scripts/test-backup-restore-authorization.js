'use strict';
// Backup and restore follow the browser's role rules on the server, and a restore moves the revision forward.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const LiveUpdates=require('../app/live-updates');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(50);}throw new Error('Timed out waiting');}
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'backup-restore-auth-'));let child,live;
 try {
  fs.cpSync('app',path.join(temp,'app'),{recursive:true});fs.copyFileSync('server-node.js',path.join(temp,'server-node.js'));fs.mkdirSync(path.join(temp,'data'));
  const password='test-password',dbFile=path.join(temp,'data/database.json');
  const roles={owner:'مالك',manager:'مدير',accountant:'محاسب',cashier:'كاشير',warehouse:'مخزن',shipping:'شحن'};
  const users=Object.entries(roles).map(([username,role],i)=>{const salt=`salt-${i}`;return {id:`U${i+1}`,username,name:username,role,active:true,salt,passwordHash:crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')};});
  fs.writeFileSync(dbFile,JSON.stringify({version:4,meta:{dataRevision:7},users,settings:{companyName:'original',tracking:{enabled:false},permissions:{roles:{},users:{}}},audit:[],sales:[],books:[]}));
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['server-node.js'],{cwd:temp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TRACKING_RPA_ENABLED:'false'},stdio:'ignore'});
  await until(async()=>{try{return (await fetch(base+'/api/health')).ok;}catch{return false;}});
  const tokens={};
  for(const username of Object.keys(roles))tokens[username]=(await (await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})})).json()).token;
  const call=(route,username,{method='GET',body}={})=>fetch(base+route,{method,headers:{'X-Session-Token':tokens[username],'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});

  for(const username of ['cashier','warehouse','shipping']){
   assert.equal((await call('/api/backup',username,{method:'POST'})).status,403,`${username} cannot create backups`);
   assert.equal((await call('/api/backups',username)).status,403,`${username} cannot list backups`);
  }
  const first=await call('/api/backup','accountant',{method:'POST'});
  assert.equal(first.status,200,'accountant may create backups (client backup-db rule)');
  const backupFile=(await first.json()).file;
  assert.equal((await call('/api/backups','accountant')).status,200);
  console.log('PASS backup follows the client roles (owner, manager, accountant)');

  // Move the live database past the backup: three saves.
  for(const name of ['one','two','three']){
   const response=await call('/api/db','owner'),db=await response.json();db.settings.companyName=name;
   const saved=await fetch(base+'/api/db',{method:'PUT',headers:{'X-Session-Token':tokens.owner,'Content-Type':'application/json','If-Match':response.headers.get('x-db-revision')},body:JSON.stringify(db)});
   assert.equal(saved.status,200,await saved.clone().text());
  }
  const before=Number(JSON.parse(fs.readFileSync(dbFile,'utf8')).meta.dataRevision);
  assert.equal(before,10);

  for(const username of ['accountant','cashier','warehouse','shipping'])assert.equal((await call('/api/restore',username,{method:'POST',body:{file:backupFile}})).status,403,`${username} cannot restore`);
  // Saved permissions cannot lift restore beyond owner/manager.
  const permissionResponse=await call('/api/db','owner'),permissionDb=await permissionResponse.json();
  permissionDb.settings.permissions.roles['محاسب']={actions:['backup-db','restore-db']};
  assert.equal((await fetch(base+'/api/db',{method:'PUT',headers:{'X-Session-Token':tokens.owner,'Content-Type':'application/json','If-Match':permissionResponse.headers.get('x-db-revision')},body:JSON.stringify(permissionDb)})).status,200);
  assert.equal((await call('/api/restore','accountant',{method:'POST',body:{file:backupFile}})).status,403,'restore stays owner/manager only');
  assert.equal(JSON.parse(fs.readFileSync(dbFile,'utf8')).settings.companyName,'three','nothing was restored');
  console.log('PASS restore is limited to owner and manager');

  const current=String(JSON.parse(fs.readFileSync(dbFile,'utf8')).meta.dataRevision);
  const seen=[];
  live=LiveUpdates.create({fetch:(url,opts)=>fetch(base+url,opts),headers:()=>({'X-Session-Token':tokens.cashier}),onRevision:r=>seen.push(r),delay:()=>sleep(10)});live.start();
  await until(()=>seen.includes(current));
  const restore=await call('/api/restore','manager',{method:'POST',body:{file:backupFile}});
  assert.equal(restore.status,200,await restore.clone().text());
  const result=await restore.json(),after=JSON.parse(fs.readFileSync(dbFile,'utf8'));
  assert.equal(after.settings.companyName,'original','the backup content is restored');
  assert.equal(after.meta.dataRevision,Number(current)+1,'the revision moves forward instead of back to the backup revision (7)');
  assert.equal(result.revision,String(after.meta.dataRevision));assert.equal(restore.headers.get('x-db-revision'),result.revision);
  assert.equal(after.audit.at(-1).operationType,'DATABASE_RESTORED');assert.equal(after.audit.at(-1).username,'manager');
  await until(()=>seen.includes(result.revision));
  console.log('PASS restore bumps the revision, records an audit entry and notifies live clients');

  const stale=await fetch(base+'/api/db',{method:'PUT',headers:{'X-Session-Token':tokens.owner,'Content-Type':'application/json','If-Match':current},body:JSON.stringify(after)});
  assert.equal(stale.status,409,'a page that loaded before the restore cannot save over it');

  // Even over an unreadable database file, a restore never reuses a revision the server already handed out.
  fs.writeFileSync(dbFile,'{"broken":');
  const rescue=await call('/api/restore','owner',{method:'POST',body:{file:backupFile}});
  assert.equal(rescue.status,200,await rescue.clone().text());
  const rescued=JSON.parse(fs.readFileSync(dbFile,'utf8'));
  assert.equal(rescued.settings.companyName,'original');
  assert.equal(rescued.meta.dataRevision,Number(result.revision)+1,'revision continues after the last one clients saw');
  assert(fs.readdirSync(path.join(temp,'data/backups')).some(name=>fs.readFileSync(path.join(temp,'data/backups',name),'utf8')==='{"broken":'),'the unreadable file is kept as a backup');
  console.log('PASS restoring over an unreadable database keeps a copy and keeps the revision moving forward');
  console.log('PASS backup/restore authorization checks completed');
 } finally {
  if(live)live.stop();
  if(child)child.kill();
  fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
