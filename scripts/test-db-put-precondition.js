'use strict';
// PUT /api/db must name the revision it replaces (If-Match). Only the first save that creates a missing database may omit it.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(50);}throw new Error('Timed out waiting for server');}
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
async function startServer(temp){
 const port=await freePort(),base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server-node.js'],{cwd:temp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TRACKING_RPA_ENABLED:'false'},stdio:'ignore'});
 await until(async()=>{try{return (await fetch(base+'/api/health')).ok;}catch{return false;}});
 return {child,base};
}
function workspace(name){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),name));
 fs.cpSync('app',path.join(temp,'app'),{recursive:true});fs.copyFileSync('server-node.js',path.join(temp,'server-node.js'));fs.mkdirSync(path.join(temp,'data'));
 return temp;
}
const login=async(base,username,password)=>(await (await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})})).json()).token;
const put=(base,token,db,headers={})=>fetch(base+'/api/db',{method:'PUT',headers:{'X-Session-Token':token,'Content-Type':'application/json',...headers},body:JSON.stringify(db)});
(async()=>{
 const temps=[],children=[];
 try {
  // Existing database: If-Match is mandatory.
  const temp=workspace('db-put-precondition-');temps.push(temp);
  const salt='s',password='test-password',dbFile=path.join(temp,'data/database.json');
  fs.writeFileSync(dbFile,JSON.stringify({version:4,meta:{dataRevision:3},
   users:[{id:'U1',username:'owner',name:'Owner',role:'مالك',active:true,salt,passwordHash:crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')}],
   settings:{companyName:'before',tracking:{enabled:false}},audit:[],sales:[],books:[{id:'B1',name:'كتاب',stock:1,price:10}]}));
  const server=await startServer(temp);children.push(server.child);
  const token=await login(server.base,'owner',password);
  const response=await fetch(server.base+'/api/db',{headers:{'X-Session-Token':token}}),db=await response.json(),revision=response.headers.get('x-db-revision');
  assert.equal(revision,'3');
  db.settings.companyName='without-if-match';
  let r=await put(server.base,token,db);
  assert.equal(r.status,428);assert.equal((await r.json()).code,'PRECONDITION_REQUIRED');
  assert.equal(JSON.parse(fs.readFileSync(dbFile,'utf8')).settings.companyName,'before','nothing saved without If-Match');
  console.log('PASS a whole-database save without If-Match is refused with 428');
  r=await put(server.base,token,db,{'If-Match':'2'});
  assert.equal(r.status,409);assert.equal((await r.json()).code,'DATABASE_WRITE_BLOCKED_STALE_REVISION');
  console.log('PASS a stale If-Match is still refused with 409');
  db.settings.companyName='with-if-match';
  r=await put(server.base,token,db,{'If-Match':revision});
  assert.equal(r.status,200,await r.clone().text());assert.equal(r.headers.get('x-db-revision'),'4');
  assert.equal(JSON.parse(fs.readFileSync(dbFile,'utf8')).settings.companyName,'with-if-match');
  console.log('PASS a save with the current If-Match is stored');

  // New install: database.json is missing, so the first browser may create it without If-Match (client bootstrap).
  const fresh=workspace('db-put-bootstrap-');temps.push(fresh);
  const freshServer=await startServer(fresh);children.push(freshServer.child);
  const bootstrapToken=await login(freshServer.base,'owner','DotCom@2026');
  assert.ok(bootstrapToken,'a brand-new install still accepts the documented first login');
  assert.equal((await fetch(freshServer.base+'/api/db',{headers:{'X-Session-Token':bootstrapToken}})).status,404);
  const seed={version:4,books:[],sales:[],settings:{companyName:'bootstrap'},audit:[]};
  r=await put(freshServer.base,bootstrapToken,seed);
  assert.equal(r.status,200,await r.clone().text());
  assert.equal(JSON.parse(fs.readFileSync(path.join(fresh,'data/database.json'),'utf8')).settings.companyName,'bootstrap');
  console.log('PASS the first save may create a missing database without If-Match');
  r=await put(freshServer.base,bootstrapToken,{...seed,settings:{companyName:'second'}});
  assert.equal(r.status,428,'once the file exists, If-Match is required again');
  console.log('PASS after bootstrap, saves need If-Match');
  console.log('PASS PUT /api/db precondition checks completed');
 } finally {
  for(const child of children)child.kill();
  for(const temp of temps)fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
