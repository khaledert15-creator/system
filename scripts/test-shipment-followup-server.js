'use strict';
// Server side of the shipping follow-up: "delivered" at our warehouse is recorded as a return, a delivered parcel
// closes its open complaints, and complaints get follow-ups / a parcel can be marked as not needing one.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),http=require('node:http'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(50);}throw new Error('Timed out waiting for server');}
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});

const offices={ENO11111111EG:'مكتب بريد أولاد صقر - الشرقية',ENO22222222EG:'مكتب بريد أولاد صقر - الشرقية',ENO33333333EG:'مكتب بريد الزقازيق',ENO55555555EG:'منطقة توزيع أولاد صقر'};
// ENO5 is only in the delivery stage at أولاد صقر: «اكتمال الطلب» has not happened, so it is neither delivered nor a return.
const delivered=trackingNumber=>({success:true,trackingNumber,confirmedStatus:'delivered',timeline:[
  {statusText:'تم قبول الشحنة',normalizedStatus:'in_transit',stage:'الشحن',location:'مكتب بريد أولاد صقر - الشرقية',eventAt:'2026-10-20T10:00:00.000Z'},
  trackingNumber==='ENO55555555EG'
    ?{statusText:'تم التسليم',normalizedStatus:'delivered',stage:'التسليم',location:offices[trackingNumber],eventAt:'2026-10-27T10:00:00.000Z'}
    :{statusText:'تم التسليم',normalizedStatus:'delivered',stage:'اكتمال الطلب',location:offices[trackingNumber],eventAt:'2026-10-27T10:00:00.000Z'}]});
function fakeAgent(){
  const jobs=new Map();
  return http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    const url=new URL(req.url,'http://agent'),id=req.headers['x-request-id'],reply=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
    if(url.pathname==='/health')return reply(200,{status:'ok',browserAvailable:true,maxBatchSize:10});
    if(req.method==='POST'&&url.pathname==='/track-batch'){
      const payload=JSON.parse(body||'{}');
      if(!jobs.has(id))jobs.set(id,{batch:true,success:true,results:payload.items.map(({trackingNumber,shipmentId})=>({...delivered(trackingNumber),shipmentId}))});
      return reply(202,{status:'accepted',requestId:id});
    }
    if(req.method==='POST'&&url.pathname==='/track'){const payload=JSON.parse(body||'{}');if(!jobs.has(id))jobs.set(id,delivered(payload.trackingNumber));return reply(202,{status:'accepted',requestId:id});}
    const m=url.pathname.match(/^\/track\/(.+)$/);
    if(req.method==='GET'&&m)return jobs.has(m[1])?reply(200,jobs.get(m[1])):reply(404,{});
    reply(404,{});
  });});
}

(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'shipment-followup-'));let child,agent;
  try{
    const agentPort=await freePort();agent=fakeAgent().listen(agentPort,'127.0.0.1');
    fs.cpSync('app',path.join(temp,'app'),{recursive:true});fs.copyFileSync('server-node.js',path.join(temp,'server-node.js'));fs.mkdirSync(path.join(temp,'data'));
    const salt='s',password='test-password',dbFile=path.join(temp,'data/database.json'),now=new Date().toISOString();
    const shipment=(id,trackingNumber,extra={})=>({id,trackingNumber,tracking:trackingNumber,carrier:'البريد المصري',company:'البريد المصري',carrierCode:'EGYPT_POST',trackingEnabled:true,status:'تم الشحن',shippingStatus:'shipped',normalizedStatus:'shipped',onlineOrderId:`ORD-${id}`,governorate:'الشرقية',city:'الزقازيق',createdAt:now,updatedAt:now,...extra});
    fs.writeFileSync(dbFile,JSON.stringify({version:4,meta:{dataRevision:0},
      users:[{id:'U1',username:'owner',name:'Owner',role:'مالك',active:true,salt,passwordHash:crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')}],
      settings:{tracking:{enabled:false,minDelaySeconds:5,rateLimitMs:10000}},audit:[],books:[],sales:[],
      onlineOrders:['SH-1','SH-2','SH-3','SH-4','SH-5','SH-6'].map(id=>({id:`ORD-${id}`,status:'تم الشحن',workflowStage:'shipped',shipmentId:id})),
      complaints:[{id:'CMP-3',shipmentId:'SH-3',complaintNumber:'C-3',status:'open',complaintStatus:'open',createdAt:now},{id:'CMP-4',shipmentId:'SH-4',complaintNumber:'C-4',status:'open',complaintStatus:'open',createdAt:now}],
      shipments:[shipment('SH-1','ENO11111111EG'),shipment('SH-2','ENO22222222EG',{city:'أولاد صقر'}),shipment('SH-3','ENO33333333EG'),shipment('SH-4','ENO44444444EG',{trackingEnabled:false}),shipment('SH-5','ENO55555555EG'),
        shipment('SH-6','ENO66666666EG',{trackingEnabled:true,status:'تم التسليم',normalizedStatus:'delivered',shippingStatus:'delivered',deliveredAt:now})]}));
    const port=await freePort(),base=`http://127.0.0.1:${port}`;
    child=spawn(process.execPath,['server-node.js'],{cwd:temp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TRACKING_RPA_ENABLED:'true',TRACKING_RPA_BASE_URL:`http://127.0.0.1:${agentPort}`,TRACKING_RPA_SHARED_SECRET:'secret',TRACKING_RPA_TIMEOUT_MS:'20000'},stdio:'ignore'});
    await until(async()=>{try{return (await fetch(base+'/api/health')).ok;}catch{return false;}});
    const token=(await (await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password})})).json()).token;
    const headers={'X-Session-Token':token,'Content-Type':'application/json'};
    const read=()=>JSON.parse(fs.readFileSync(dbFile,'utf8'));
    const post=(route,body,method='POST')=>fetch(base+route,{method,headers,body:JSON.stringify(body)});

    await (await fetch(`${base}/api/tracking/run`,{method:'POST',headers:{...headers,'X-Request-ID':'cycle-1'},body:JSON.stringify({shipmentIds:['SH-1','SH-2','SH-3','SH-5']})})).json();
    let db=read();const byId=id=>db.shipments.find(item=>item.id===id);
    assert.equal(byId('SH-1').normalizedStatus,'returned','delivered at the warehouse is a return');
    assert.ok(byId('SH-1').returnedToWarehouseAt);
    assert.equal(db.onlineOrders.find(item=>item.id==='ORD-SH-1').workflowStage,'returned','the order follows the return');
    assert.equal(db.trackingHistory.find(item=>item.shipmentId==='SH-1'&&item.returnedToWarehouse)?.warehousePlace,'أولاد صقر');
    assert.equal(byId('SH-2').normalizedStatus,'delivered','a customer in the warehouse town stays delivered for a person to check');
    assert.equal(byId('SH-3').normalizedStatus,'delivered');
    const closed=db.complaints.find(item=>item.id==='CMP-3');
    assert.equal(closed.status,'closed');assert.equal(closed.autoClosed,true);assert.match(closed.resolutionNotes,/اتسلمت/);
    assert.equal(byId('SH-5').normalizedStatus,'out_for_delivery','«تسليم» before «اكتمال الطلب» is not a delivery');
    assert.ok(!byId('SH-5').returnedToWarehouseAt);
    console.log('PASS warehouse delivery becomes a return; a delivered parcel closes its open complaint');

    let response=await post('/api/shipping/complaints/CMP-4/follow-up',{note:''});
    assert.equal(response.status,400);
    response=await post('/api/shipping/complaints/CMP-4/follow-up',{note:'كلمت البريد ووعدوا بكرة'});
    assert.equal(response.status,200,await response.clone().text());
    db=read();let complaint=db.complaints.find(item=>item.id==='CMP-4');
    assert.equal(complaint.followUps.length,1);assert.equal(complaint.followUps[0].byName,'Owner');assert.equal(complaint.status,'in_progress');
    assert.equal((await post('/api/shipping/complaints/CMP-3/follow-up',{note:'x'})).status,409,'a closed complaint takes no follow-up');
    console.log('PASS complaint follow-ups are recorded with who and when');

    response=await post('/api/shipping/complaint-waive',{shipmentId:'SH-4',reason:'العميل قال إنه ما كانش موجود'});
    assert.equal(response.status,200,await response.clone().text());
    db=read();assert.equal(byId('SH-4').complaintWaiveReason,'العميل قال إنه ما كانش موجود');assert.ok(byId('SH-4').complaintWaivedAt);
    console.log('PASS a parcel can be marked as not needing a complaint, with the reason');

    response=await post('/api/shipping/shipments/SH-4/status',{shippingStatus:'returned',warehouseReturn:true,notes:'رجعت للمخزن'},'PATCH');
    assert.equal(response.status,200,await response.clone().text());
    db=read();
    assert.equal(byId('SH-4').normalizedStatus,'returned');assert.ok(byId('SH-4').returnedToWarehouseAt);
    assert.equal(db.onlineOrders.find(item=>item.id==='ORD-SH-4').workflowStage,'returned');
    assert.equal(db.complaints.find(item=>item.id==='CMP-4').status,'closed','marking the return closes the open complaint');
    response=await post('/api/shipping/shipments/SH-2/status',{shippingStatus:'delivered',warehouseDelivered:true},'PATCH');
    assert.equal(response.status,200);db=read();assert.ok(byId('SH-2').warehouseDeliveryConfirmedAt);
    console.log('PASS the employee settles a warehouse delivery as a return or a real delivery');

    db.onlineOrders.find(item=>item.id==='ORD-SH-6').workflowStage='delivered';db.onlineOrders.find(item=>item.id==='ORD-SH-6').status='تم التسليم';
    fs.writeFileSync(dbFile,JSON.stringify(db));
    response=await post('/api/shipping/shipments/SH-6/status',{shippingStatus:'out_for_delivery',reopenTracking:true},'PATCH');
    assert.equal(response.status,200,await response.clone().text());
    db=read();
    assert.equal(byId('SH-6').normalizedStatus,'out_for_delivery');assert.equal(byId('SH-6').deliveredAt,'');assert.ok(byId('SH-6').reopenedAt);
    assert.equal(db.onlineOrders.find(item=>item.id==='ORD-SH-6').workflowStage,'shipped','the order goes back to shipped');
    console.log('PASS a parcel read as delivered too early goes back to tracking');

    db.settings.tracking.warehousePlaces=['أولاد صقر','فاقوس'];
    response=await fetch(base+'/api/db',{method:'PUT',headers:{...headers,'If-Match':String(db.meta.dataRevision)},body:JSON.stringify(db)});
    assert.equal(response.status,200,await response.clone().text());
    assert.deepEqual(read().settings.tracking.warehousePlaces,['أولاد صقر','فاقوس'],'warehouse places survive a settings save');
    console.log('PASS warehouse places are kept in the tracking settings');
  }finally{
    if(child)child.kill();if(agent)agent.close();
    fs.rmSync(temp,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
