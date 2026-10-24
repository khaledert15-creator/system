'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),http=require('node:http'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(50);}throw new Error('Timed out waiting for server');}
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
// Each code gets its own office, so a result applied to the wrong shipment shows up.
const success=trackingNumber=>({success:true,trackingNumber,confirmedStatus:'in_transit',timeline:[{statusText:'تم تسجيل الشحنة',normalizedStatus:'registered',location:`مكتب ${trackingNumber}`,eventAt:'2026-10-17T10:00:00.000Z'},{statusText:'الشحنة في مرحلة النقل',normalizedStatus:'in_transit',location:`مركز ${trackingNumber}`,eventAt:'2026-10-17T12:00:00.000Z'}]});

// Fake agent. Like the real one it answers a repeated X-Request-ID with the earlier result. `mode` picks how
// /track-batch behaves: 'batch' (agent 1.1.0), 'legacy' (no /track-batch, 404) or 'blocked' (site refuses).
function fakeAgent(state){
  const jobs=new Map();
  return http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    const url=new URL(req.url,'http://agent'),id=req.headers['x-request-id'];
    const reply=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
    if(url.pathname==='/health')return reply(200,{status:'ok',browserAvailable:true,...(state.mode==='legacy'?{}:{maxBatchSize:10})});
    if(req.method==='POST'&&url.pathname==='/track-batch'){
      if(state.mode==='legacy')return reply(404,{status:'not_found'});
      const payload=JSON.parse(body||'{}');state.calls.push({kind:'batch',id,codes:payload.items.map(i=>i.trackingNumber)});
      if(!jobs.has(id)){
        const results=payload.items.map(({trackingNumber,shipmentId})=>{
          if(state.mode==='blocked')return {success:false,trackingNumber,shipmentId,failureCode:'SITE_BLOCKED',failureMessage:'موقع البريد يمنع التشغيل الآلي',manualReviewRequired:true};
          if(trackingNumber==='ENO44444444EG')return {success:false,trackingNumber,shipmentId,failureCode:'BATCH_ITEM_MISSING',failureMessage:'لم يصل الرد'};
          if(trackingNumber==='ENO55555555EG')return {success:false,trackingNumber,shipmentId,failureCode:'RESULT_NOT_FOUND',failureMessage:'لم تظهر نتيجة تتبع مؤكدة',manualReviewRequired:true};
          return {...success(trackingNumber),shipmentId};
        });
        // An answer for a code that was not asked about must be ignored.
        results.push(success('ENO99999999EG'));
        jobs.set(id,{batch:true,success:true,results,stopCycle:state.mode==='blocked',failureCode:state.mode==='blocked'?'SITE_BLOCKED':''});
      }
      return reply(202,{status:'accepted',requestId:id});
    }
    if(req.method==='POST'&&url.pathname==='/track'){
      const payload=JSON.parse(body||'{}');state.calls.push({kind:'single',id,codes:[payload.trackingNumber]});
      if(!jobs.has(id))jobs.set(id,payload.trackingNumber==='ENO66666666EG'?success('ENO77777777EG'):success(payload.trackingNumber));
      return reply(202,{status:'accepted',requestId:id});
    }
    const m=url.pathname.match(/^\/track\/(.+)$/);
    if(req.method==='GET'&&m)return jobs.has(m[1])?reply(200,jobs.get(m[1])):reply(404,{});
    reply(404,{status:'not_found'});
  });});
}

async function withSystem(state,codes,run,{env={},patch=()=>{}}={}){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tracking-batch-'));let child,agent;
  try{
    const agentPort=await freePort();agent=fakeAgent(state).listen(agentPort,'127.0.0.1');
    fs.cpSync('app',path.join(temp,'app'),{recursive:true});fs.copyFileSync('server-node.js',path.join(temp,'server-node.js'));fs.mkdirSync(path.join(temp,'data'));
    const salt='s',password='test-password',dbFile=path.join(temp,'data/database.json'),now=new Date().toISOString();
    const shipment=(id,trackingNumber)=>({id,trackingNumber,tracking:trackingNumber,carrier:'البريد المصري',company:'البريد المصري',carrierCode:'EGYPT_POST',trackingEnabled:true,status:'تم الشحن',shippingStatus:'shipped',normalizedStatus:'shipped',createdAt:now,updatedAt:now});
    fs.writeFileSync(dbFile,JSON.stringify({version:4,meta:{dataRevision:0},
      users:[{id:'U1',username:'owner',name:'Owner',role:'مالك',active:true,salt,passwordHash:crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')}],
      settings:{tracking:{enabled:false,minDelaySeconds:5,rateLimitMs:10000}},audit:[],books:[],sales:[],shipments:codes.map((code,i)=>({...shipment(`SH-${i+1}`,code),...patch(i)}))}));
    const port=await freePort(),base=`http://127.0.0.1:${port}`;
    child=spawn(process.execPath,['server-node.js'],{cwd:temp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TRACKING_RPA_ENABLED:'true',TRACKING_RPA_BASE_URL:`http://127.0.0.1:${agentPort}`,TRACKING_RPA_SHARED_SECRET:'secret',TRACKING_RPA_TIMEOUT_MS:'20000',...env},stdio:'ignore'});
    await until(async()=>{try{return (await fetch(base+'/api/health')).ok;}catch{return false;}});
    const token=(await (await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password})})).json()).token;
    const runAll=async()=>(await fetch(`${base}/api/tracking/run`,{method:'POST',headers:{'X-Session-Token':token,'Content-Type':'application/json','X-Request-ID':'same-cycle-id'},body:JSON.stringify({shipmentIds:codes.map((_,i)=>`SH-${i+1}`)})})).json();
    const read=()=>JSON.parse(fs.readFileSync(dbFile,'utf8'));
    await run({runAll,read});
  }finally{
    if(child)child.kill();if(agent)agent.close();
    fs.rmSync(temp,{recursive:true,force:true});
  }
}

const ownEventsOnly=(db,shipment)=>{
  const rows=(db.trackingHistory||[]).filter(row=>row.shipmentId===shipment.id);
  assert(rows.length>0,`${shipment.id} has tracking history`);
  for(const row of rows){
    assert.equal(row.trackingNumber,shipment.trackingNumber,`${shipment.id} history row is for its own code`);
    assert.match(row.location,new RegExp(shipment.trackingNumber),`${shipment.id} has only its own events`);
  }
};

(async()=>{
  // 1. New agent: one batch search; the code the batch missed is searched alone; nothing is crossed.
  {
    const state={mode:'batch',calls:[]};
    const codes=['ENO11111111EG','ENO22222222EG','ENO33333333EG','ENO44444444EG','ENO55555555EG'];
    await withSystem(state,codes,async({runAll,read})=>{
      const started=Date.now();const summary=await runAll();
      const batches=state.calls.filter(c=>c.kind==='batch'),singles=state.calls.filter(c=>c.kind==='single');
      assert.equal(batches.length,1,'one batch search for five codes');
      assert.deepEqual(batches[0].codes,codes);
      assert.deepEqual(singles.map(c=>c.codes[0]),['ENO44444444EG'],'only the missed code is searched alone');
      // One-at-a-time would wait 10 s between each of the five; only the fallback search is followed by that wait.
      assert(Date.now()-started<25000,`batch answers are not spaced by the 10 s delay (took ${Date.now()-started} ms)`);
      const db=read();
      for(const id of ['SH-1','SH-2','SH-3','SH-4']){const s=db.shipments.find(x=>x.id===id);assert.equal(s.normalizedStatus,'in_transit',id);ownEventsOnly(db,s);}
      const notFound=db.shipments.find(x=>x.id==='SH-5');
      assert.equal(notFound.normalizedStatus,'shipped','a code with no result keeps its status');
      assert.equal(notFound.trackingFailureCode,'RESULT_NOT_FOUND');
      assert(!(db.trackingHistory||[]).some(row=>row.trackingNumber==='ENO99999999EG'),'an answer for a code nobody asked about is dropped');
      assert.equal(summary.successful,4);
    });
    console.log('PASS five shipments take one batch search; the missed code falls back to a single search; no results are crossed');
  }

  // 2. Old agent without /track-batch: every shipment is searched alone with its own request id.
  {
    const state={mode:'legacy',calls:[]};
    const codes=['ENO11111111EG','ENO22222222EG','ENO66666666EG'];
    await withSystem(state,codes,async({runAll,read})=>{
      await runAll();
      const singles=state.calls.filter(c=>c.kind==='single');
      assert.deepEqual(singles.map(c=>c.codes[0]),codes,'each code searched alone');
      assert.equal(new Set(singles.map(c=>c.id)).size,codes.length,'each search has its own request id');
      const db=read();
      for(const id of ['SH-1','SH-2']){const s=db.shipments.find(x=>x.id===id);assert.equal(s.normalizedStatus,'in_transit',id);ownEventsOnly(db,s);}
      const mismatched=db.shipments.find(x=>x.id==='SH-3');
      assert.equal(mismatched.trackingFailureCode,'TRACKING_NUMBER_MISMATCH','a result for another code is refused');
      assert.equal(mismatched.normalizedStatus,'shipped');
      assert(!(db.trackingHistory||[]).some(row=>row.shipmentId==='SH-3'),'no events written for the mismatched answer');
    });
    console.log('PASS an older agent still works one code at a time, each search with its own request id; a result for another code is refused');
  }

  // 3. Site refuses: the cycle stops at the first shipment and leaves the rest untouched.
  {
    const state={mode:'blocked',calls:[]};
    const codes=['ENO11111111EG','ENO22222222EG','ENO33333333EG'];
    await withSystem(state,codes,async({runAll,read})=>{
      const summary=await runAll();
      assert.equal(summary.checked,1,'only the first shipment is processed');
      assert.equal(summary.stoppedEarly?.failureCode,'SITE_BLOCKED');
      assert.equal(summary.stoppedEarly?.remaining,2);
      assert.equal(state.calls.filter(c=>c.kind==='single').length,0,'no single searches against a blocking site');
      const db=read();
      for(const id of ['SH-2','SH-3']){const s=db.shipments.find(x=>x.id===id);assert(!s.lastTrackingAt,`${id} untouched`);assert(!s.manualInterventionNeeded,`${id} not flagged`);}
    });
    console.log('PASS a blocking site stops the cycle at once and leaves the other shipments untouched');
  }

  // 4. Worker tick: one shipment is due; three more fall due within 30 minutes and join its batch; one due in 2 h
  // waits. Shipped shipments are tracked every 4 h.
  {
    const state={mode:'batch',calls:[]};
    const codes=['ENO11111111EG','ENO22222222EG','ENO33333333EG','ENO44444444EG','ENO55555555EG'];
    const hoursAgo=[4.1,3.9,3.75,3.6,2];
    await withSystem(state,codes,async({read})=>{
      const seeded=read().shipments.find(x=>x.id==='SH-5').lastTrackingAt;
      for(let i=0;i<300&&read().shipments.filter(s=>s.lastTrackedAt).length<4;i++)await sleep(100);
      const batches=state.calls.filter(c=>c.kind==='batch');
      assert(batches.length>=1,'a batch search ran');
      assert.deepEqual(batches[0].codes,codes.slice(0,4),'the due shipment and the three due within 30 minutes share one search');
      const db=read();
      assert.equal(db.shipments.filter(s=>s.lastTrackedAt).length,4,'all four were updated');
      assert.equal(db.shipments.find(x=>x.id==='SH-5').lastTrackingAt,seeded,'a shipment due in 2 hours is not checked early');
      assert(!state.calls.some(c=>c.codes.includes('ENO55555555EG')),'its code is never searched');
    },{env:{TRACKING_WORKER_TICK_MS:'1000'},patch:i=>({lastTrackingAt:new Date(Date.now()-hoursAgo[i]*3600000).toISOString()})});
    console.log('PASS the worker groups shipments falling due within 30 minutes into one batch search');
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
