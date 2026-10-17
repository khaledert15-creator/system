'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),http=require('node:http'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(50);}throw new Error('Timed out waiting for server');}
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const success=trackingNumber=>({success:true,trackingNumber,confirmedStatus:'in_transit',timeline:[{statusText:'تم تسجيل الشحنة',normalizedStatus:'registered',location:'مكتب',eventAt:'2026-10-17T10:00:00.000Z'},{statusText:'في الطريق',normalizedStatus:'in_transit',location:'مركز',eventAt:'2026-10-17T12:00:00.000Z'}]});
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tracking-retry-'));let child,agent;
 try {
  // Fake local agent with async jobs. ENO1: one poll is dropped mid-way. ENO2: answers BUSY. ENO3: legacy agent
  // that ignores ?async=1 and answers with the full result.
  const seen=[],jobs=new Map();let droppedPoll=false;
  const agentPort=await freePort();
  agent=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    const url=new URL(req.url,'http://agent');
    if(url.pathname==='/health'){res.end(JSON.stringify({status:'ok',browserAvailable:true}));return;}
    if(req.method==='POST'&&url.pathname==='/track'){
      const payload=JSON.parse(body||'{}'),id=req.headers['x-request-id'];seen.push({id,tn:payload.trackingNumber,kind:'start'});
      const result=payload.trackingNumber==='ENO22222222EG'?{success:false,trackingNumber:payload.trackingNumber,failureCode:'BUSY',failureMessage:'خدمة RPA مشغولة الآن'}:success(payload.trackingNumber);
      if(payload.trackingNumber==='ENO33333333EG'||url.searchParams.get('async')!=='1'){res.end(JSON.stringify(result));return;}
      if(!jobs.has(id))jobs.set(id,{readyAt:Date.now()+1500,result});
      res.statusCode=202;res.end(JSON.stringify({status:'accepted',requestId:id}));return;
    }
    const m=url.pathname.match(/^\/track\/(.+)$/);
    if(req.method==='GET'&&m){const job=jobs.get(m[1]);seen.push({id:m[1],kind:'poll'});
      if(!job){res.statusCode=404;res.end('{}');return;}
      if(!droppedPoll&&job.result.trackingNumber==='ENO11111111EG'){droppedPoll=true;req.socket.destroy();return;}
      if(Date.now()<job.readyAt){res.statusCode=202;res.end(JSON.stringify({status:'pending'}));return;}
      res.end(JSON.stringify(job.result));return;}
    res.statusCode=404;res.end('{}');
  });}).listen(agentPort,'127.0.0.1');
  fs.cpSync('app',path.join(temp,'app'),{recursive:true});fs.copyFileSync('server-node.js',path.join(temp,'server-node.js'));fs.mkdirSync(path.join(temp,'data'));
  const salt='s',password='test-password',dbFile=path.join(temp,'data/database.json'),now=new Date().toISOString();
  const shipment=(id,trackingNumber)=>({id,trackingNumber,tracking:trackingNumber,carrier:'البريد المصري',company:'البريد المصري',carrierCode:'EGYPT_POST',trackingEnabled:true,status:'تم الشحن',shippingStatus:'shipped',normalizedStatus:'shipped',createdAt:now,updatedAt:now});
  fs.writeFileSync(dbFile,JSON.stringify({version:4,meta:{dataRevision:0},
   users:[{id:'U1',username:'owner',name:'Owner',role:'مالك',active:true,salt,passwordHash:crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')}],
   settings:{tracking:{enabled:false}},audit:[],books:[],sales:[],shipments:[shipment('SH-1','ENO11111111EG'),shipment('SH-2','ENO22222222EG'),shipment('SH-3','ENO33333333EG')]}));
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['server-node.js'],{cwd:temp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TRACKING_RPA_ENABLED:'true',TRACKING_RPA_BASE_URL:`http://127.0.0.1:${agentPort}`,TRACKING_RPA_SHARED_SECRET:'secret',TRACKING_RPA_TIMEOUT_MS:'20000'},stdio:'ignore'});
  await until(async()=>{try{return (await fetch(base+'/api/health')).ok;}catch{return false;}});
  const token=(await (await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password})})).json()).token;
  const track=id=>fetch(`${base}/api/tracking/shipment/${id}`,{method:'POST',headers:{'X-Session-Token':token,'Content-Type':'application/json'},body:'{}'});
  const ship=id=>JSON.parse(fs.readFileSync(dbFile,'utf8')).shipments.find(s=>s.id===id);

  let r=await track('SH-1');const body=await r.text();
  const one=ship('SH-1'),starts=seen.filter(x=>x.kind==='start'),polls=seen.filter(x=>x.kind==='poll');
  assert.equal(starts.length,1,'the search is started once');
  assert(polls.length>=2,'the result is fetched with short polling requests');
  assert.equal(new Set(polls.map(x=>x.id)).size,1,'polls use the same request id');
  assert.equal(one.trackingError||'','',body);assert.equal(one.normalizedStatus,'in_transit');
  console.log('PASS the job is started then polled; a dropped poll is retried and the result is kept');

  r=await track('SH-2');await r.text();
  const two=ship('SH-2');
  assert.equal(two.trackingError||'','','busy is not shown as a failed update');
  assert.equal(Number(two.trackingErrorCount||0),0);
  const minutes=(new Date(two.nextTrackingAt)-Date.now())/60000;
  assert(minutes>5&&minutes<=16,`busy retries within minutes, got ${minutes}`);
  assert.match(two.trackingNotice,/مشغولة/);
  console.log('PASS a busy agent postpones the shipment by minutes, not hours, without an error');

  r=await track('SH-3');await r.text();
  assert.equal(ship('SH-3').normalizedStatus,'in_transit');
  console.log('PASS an agent without async support still works');
 } finally {
  if(child)child.kill();if(agent)agent.close();
  fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
