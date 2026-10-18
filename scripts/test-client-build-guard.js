'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(50);}throw new Error('Timed out waiting for server');}
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'build-guard-'));let child;
 try {
  fs.cpSync('app',path.join(temp,'app'),{recursive:true});fs.copyFileSync('server-node.js',path.join(temp,'server-node.js'));fs.mkdirSync(path.join(temp,'data'));
  const salt='s',password='test-password',dbFile=path.join(temp,'data/database.json');
  fs.writeFileSync(dbFile,JSON.stringify({version:4,meta:{dataRevision:0},users:[{id:'U1',username:'owner',name:'Owner',role:'مالك',active:true,salt,passwordHash:crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')}],
   settings:{tracking:{enabled:false}},audit:[],books:[],sales:[],stockMovements:[{id:'MOV-0f4f7d10-6426-4fb9-bd5d-9473a0feccc2'}],notifications:[]}));
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const base=`http://127.0.0.1:${port}`,build='testbuild01';
  child=spawn(process.execPath,['server-node.js'],{cwd:temp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TRACKING_RPA_ENABLED:'false',NODE_ENV:'production',APP_BUILD_SHA:build},stdio:'ignore'});
  await until(async()=>{try{return (await fetch(base+'/api/health')).ok;}catch{return false;}});
  const html=await (await fetch(base+'/')).text();
  assert.match(html,new RegExp(`<meta name="app-build" content="${build}">`),'the page carries its build');
  const token=(await (await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password})})).json()).token;
  const db=await (await fetch(base+'/api/db',{headers:{'X-Session-Token':token}})).json();
  db.settings.companyName='saved';
  db.stockMovements.push({id:'MOV-2.3412404047828986e+26',note:'a'},{id:'MOV-2.3412404047828986e+26',note:'b'},{id:'MOV-0f4f7d10-6426-4fb9-bd5d-9473a0feccc2',note:'reused'});
  db.notifications.push({id:'NOT-1'},{id:'NOT-1'});
  const put=headers=>fetch(base+'/api/db',{method:'PUT',headers:{'X-Session-Token':token,'Content-Type':'application/json',...headers},body:JSON.stringify(db)});

  let r=await put({});
  assert.equal(r.status,409);let body=await r.json();assert.equal(body.code,'CLIENT_OUTDATED');assert.match(body.message,/حدّث الصفحة/);
  r=await put({'X-App-Build':'oldbuild'});assert.equal(r.status,409);
  assert.equal(JSON.parse(fs.readFileSync(dbFile,'utf8')).settings.companyName,undefined,'nothing saved from an old page');
  console.log('PASS saves from a page running an older build are refused');

  r=await put({'X-App-Build':build});assert.equal(r.status,200,await r.clone().text());
  const after=JSON.parse(fs.readFileSync(dbFile,'utf8'));
  assert.equal(after.settings.companyName,'saved');
  for(const key of ['stockMovements','notifications']){const ids=after[key].map(x=>x.id);assert.equal(new Set(ids).size,ids.length,`${key} ids are unique`);assert(!ids.some(id=>/e\+\d/.test(id)),`${key} has no float ids`);}
  assert.equal(after.stockMovements[0].id,'MOV-0f4f7d10-6426-4fb9-bd5d-9473a0feccc2','the original record keeps its id');
  assert.equal(after.stockMovements.filter(x=>x.repairedFromId).length,3);
  console.log('PASS duplicate and broken ids from a save are replaced with unique ids');

  const live=await (await fetch(base+'/api/live-revision',{headers:{'X-Session-Token':token}})).json();
  assert.equal(live.build,build);
  console.log('PASS live revision reports the server build');
 } finally {
  if(child)child.kill();
  fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
