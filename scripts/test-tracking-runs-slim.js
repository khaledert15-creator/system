'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto'),vm=require('node:vm');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(50);}throw new Error('Timed out waiting for server');}

const source=fs.readFileSync('server-node.js','utf8');
const start=source.indexOf('const TRACKING_RUNS_WITH_RAW'),end=source.indexOf('\nfunction buildTrackingRunRecord');
const c={};vm.createContext(c);vm.runInContext(source.slice(start,end)+';globalThis.slim=slimTrackingRuns;',c);
const run=(i,status)=>({id:`TRUN-${i}`,status,rawResult:{big:'x'.repeat(100)},parsedResult:{events:[1]}});
const runs=[...Array.from({length:300},(_,i)=>run(i,i%3===0?'failed':'success'))];
const slim=c.slim(runs);
assert.equal(slim.length,300,'no run is removed');
assert(slim.slice(-50).every(r=>r.rawResult),'latest 50 runs keep raw replies');
const failedWithRaw=slim.filter(r=>r.status==='failed'&&r.rawResult).length;
assert.equal(failedWithRaw,100,'the latest 100 failures keep raw replies');
assert(slim.slice(0,50).filter(r=>r.status==='success').every(r=>r.rawResult===undefined&&r.parsedResult===undefined),'old successful runs are slimmed');
assert(slim.every(r=>r.id&&r.status),'run id and status are always kept');
assert.deepEqual(c.slim(slim),slim,'slimming twice changes nothing');
console.log('PASS old successful runs drop raw replies; recent runs and failures keep them');

(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'runs-slim-'));let child;
 try {
  fs.cpSync('app',path.join(temp,'app'),{recursive:true});fs.copyFileSync('server-node.js',path.join(temp,'server-node.js'));fs.mkdirSync(path.join(temp,'data'));
  const salt='s',password='test-password',dbFile=path.join(temp,'data/database.json');
  fs.writeFileSync(dbFile,JSON.stringify({version:4,meta:{dataRevision:0},users:[{id:'U1',username:'owner',name:'Owner',role:'مالك',active:true,salt,passwordHash:crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')}],
   settings:{tracking:{enabled:false}},audit:[],books:[],sales:[],trackingRuns:[{id:'TRUN-1',status:'success'},{id:'TRUN-2',status:'failed'}],trackingRunBatches:[{id:'TRB-1'}]}));
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['server-node.js'],{cwd:temp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TRACKING_RPA_ENABLED:'false'},stdio:'ignore'});
  await until(async()=>{try{return (await fetch(base+'/api/health')).ok;}catch{return false;}});
  const token=(await (await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password})})).json()).token;
  const db=await (await fetch(base+'/api/db',{headers:{'X-Session-Token':token}})).json();
  db.trackingRuns=[{id:'TRUN-OLD',status:'success',rawResult:{stale:true}}];db.trackingRunBatches=[];db.settings.companyName='saved';
  const r=await fetch(base+'/api/db',{method:'PUT',headers:{'X-Session-Token':token,'Content-Type':'application/json'},body:JSON.stringify(db)});
  assert.equal(r.status,200,await r.clone().text());
  const after=JSON.parse(fs.readFileSync(dbFile,'utf8'));
  assert.deepEqual(after.trackingRuns.map(x=>x.id),['TRUN-1','TRUN-2'],'client save keeps the server tracking runs');
  assert.equal(after.trackingRunBatches.length,1);assert.equal(after.settings.companyName,'saved');
  console.log('PASS a client save cannot replace the server tracking logs');
 } finally {
  if(child)child.kill();
  fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
