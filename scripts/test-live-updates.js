'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto'),vm=require('node:vm');
const {spawn}=require('node:child_process');
const LiveUpdates=require('../app/live-updates');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(50);}throw new Error('Timed out waiting for update');}
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'live-sync-'));let child;const clients=[];
 try {
  fs.cpSync('app',path.join(temp,'app'),{recursive:true});fs.copyFileSync('server-node.js',path.join(temp,'server-node.js'));fs.mkdirSync(path.join(temp,'data'));
  const salt='test-salt',password='test-password';
  fs.writeFileSync(path.join(temp,'data/database.json'),JSON.stringify({version:4,meta:{dataRevision:0},users:[{id:'U1',username:'owner',name:'Owner',role:'مالك',active:true,salt,passwordHash:crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')}],books:[],sales:[],settings:{tracking:{enabled:false}},audit:[]}));
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['server-node.js'],{cwd:temp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TRACKING_RPA_ENABLED:'false'},stdio:'ignore'});
  await until(async()=>{try{return (await fetch(base+'/api/health')).ok;}catch{return false;}});
  assert.equal((await fetch(base+'/api/events')).status,401);
  const tokens=await Promise.all([1,2].map(async()=>{const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password})});assert(r.ok);return (await r.json()).token;}));
  const seen=[[],[]];
  tokens.forEach((token,i)=>{const client=LiveUpdates.create({fetch:(url,opts)=>fetch(base+url,opts),headers:()=>({'X-Session-Token':token}),onRevision:r=>seen[i].push(r),delay:()=>sleep(10)});clients.push(client);client.start();});
  await until(()=>seen.every(rows=>rows.includes('0')));
  const headers={'X-Session-Token':tokens[0],'Content-Type':'application/json','If-Match':'0'};
  const db=await (await fetch(base+'/api/db',{headers})).json();db.settings.companyName='Live test';
  const write=await fetch(base+'/api/db',{method:'PUT',headers,body:JSON.stringify(db)});assert.equal(write.status,200,await write.text());
  await until(()=>seen.every(rows=>rows.includes('1')));
  console.log('PASS authenticated independent sessions receive committed revision immediately');
  const stale=await fetch(base+'/api/db',{method:'PUT',headers,body:JSON.stringify(db)});assert.equal(stale.status,409);
  assert.equal((await (await fetch(base+'/api/live-revision',{headers})).json()).revision,'1');
  clients[1].stop();clients[1].start();await until(()=>seen[1].filter(r=>r==='1').length>=2);
  console.log('PASS stale writes remain blocked; reconnect receives current revision');
  const source=fs.readFileSync('app/app.js','utf8');
  function fn(name){const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));return source.slice(start,source.indexOf('\n}',start)+2);}
  const c={sessionToken:'test',serverConnected:true,liveTargetRevision:'2',liveRefreshRunning:false,liveMutationCount:0,saleSaveInFlight:false,lastSaveError:null,saveQueue:Promise.resolve(),liveMutationEpoch:0,dbRevision:'1',data:{books:[]},scheduleLiveRefresh(){},authHeaders:()=>({}),AbortSignal,normalizeData:d=>d,cacheDataLocally(){},renderLiveData(){c.rendered=true;},setStorageStatus(){}};
  c.fetch=async()=>new Response(JSON.stringify({books:[{id:'B1',stock:5}]}),{headers:{'X-DB-Revision':'2'}});vm.createContext(c);vm.runInContext(fn('applyLiveRevision'),c);
  c.liveMutationCount=1;await c.applyLiveRevision();assert.equal(c.dbRevision,'1');assert.equal(c.rendered,undefined);
  c.liveMutationCount=0;await c.applyLiveRevision();assert.equal(c.data.books[0].stock,5);assert.equal(c.dbRevision,'2');assert.equal(c.liveTargetRevision,null);
  c.liveTargetRevision='3';c.fetch=async()=>{c.data.books[0].stock=4;return new Response(JSON.stringify({books:[]}),{headers:{'X-DB-Revision':'3'}});};await c.applyLiveRevision();assert.equal(c.data.books[0].stock,4);assert.equal(c.dbRevision,'2');
  console.log('PASS remote refresh defers writes and never overwrites edits made during fetch');
  const makeControl=value=>({id:'sale-notes',name:'',className:'',type:'text',dataset:{},value,checked:false,selectionStart:3,selectionEnd:3,closest:()=>null,focus(){this.focused=true;},setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;}});
  const original=makeControl('unsaved note');let controls=[original];
  const ui={liveRendering:false,currentView:'sales',liveDirtyControls:new WeakSet([original]),document:{activeElement:original,getElementById:()=>null},root:{querySelectorAll:selector=>selector==='input,select,textarea'?controls:[]},window:{scrollX:0,scrollY:123,scrollTo(o){ui.scroll=o;}},updateNotificationBadge(){},updateSidebarBadges(){},scheduleStickyTableScrollbar(){}};
  for(const name of ['Dashboard','Books','Sales','OnlineOrders','Purchases','Returns','Parties','Shipping','Accounting','Reports','Hr','Settings'])ui['render'+name]=()=>{controls=[makeControl('server default')];};
  vm.createContext(ui);vm.runInContext(fn('liveControlKey')+'\n'+fn('renderLiveData'),ui);ui.renderLiveData();
  assert.equal(controls[0].value,'unsaved note');assert.equal(controls[0].focused,true);assert.equal(controls[0].selectionStart,3);assert.equal(ui.scroll.top,123);
  console.log('PASS live render preserves typed fields, focus, selection and page scroll');

 } finally {clients.forEach(c=>c.stop());if(child){child.kill();await new Promise(r=>child.once('exit',r));}fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
