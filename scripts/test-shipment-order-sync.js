'use strict';
// A parcel follows its order's final state: refused or returned orders show their parcel as a return, cancelled
// orders as cancelled — fixed once at start-up for old data, and kept that way on every save afterwards.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,tries=100){for(let i=0;i<tries;i++){if(await fn())return;await sleep(50);}throw new Error('Timed out');}
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});

(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'shipment-order-sync-'));let child;
  try{
    fs.cpSync('app',path.join(temp,'app'),{recursive:true});fs.copyFileSync('server-node.js',path.join(temp,'server-node.js'));fs.mkdirSync(path.join(temp,'data'));
    const salt='s',password='test-password',dbFile=path.join(temp,'data/database.json'),now=new Date().toISOString();
    const transit={status:'في مرحلة نقل',currentStatus:'في مرحلة نقل',normalizedStatus:'in_transit',shippingStatus:'in_transit',trackingStatus:'in_transit',carrier:'البريد المصري',createdAt:now};
    fs.writeFileSync(dbFile,JSON.stringify({version:4,meta:{dataRevision:0},
      users:[{id:'U1',username:'owner',name:'Owner',role:'مالك',active:true,salt,passwordHash:crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')}],
      settings:{tracking:{enabled:false}},audit:[],books:[],sales:[],
      onlineOrders:[
        {id:'ORD-0379',status:'مرتجع',workflowStage:'returned',shipmentId:'SH-1',refusal:{outcome:'keep_deposit',repaired:true},refusedAt:'2026-10-27T10:00:00.000Z'},
        {id:'ORD-2',status:'ملغي',workflowStage:'cancelled',shipmentId:'SH-2',cancelledAt:'2026-10-28T10:00:00.000Z'},
        {id:'ORD-3',status:'تم التجهيز',workflowStage:'awaiting_shipping',shipmentId:null},
        {id:'ORD-4',status:'تم الشحن',workflowStage:'shipped',shipmentId:'SH-4'},
        {id:'ORD-5',status:'ملغي',workflowStage:'cancelled',shipmentId:'SH-5'}
      ],
      shipments:[
        {id:'SH-1',onlineOrderId:'ORD-0379',...transit},
        {id:'SH-2',onlineOrderId:'ORD-2',...transit},
        {id:'SH-3',onlineOrderId:'ORD-3',...transit,status:'ملغاة',normalizedStatus:'cancelled',shippingStatus:'cancelled',cancelledAt:now},
        {id:'SH-4',onlineOrderId:'ORD-4',...transit},
        {id:'SH-5',onlineOrderId:'ORD-5',...transit,status:'تم التسليم',normalizedStatus:'delivered',shippingStatus:'delivered',trackingStatus:'delivered'}
      ]}));
    const port=await freePort(),base=`http://127.0.0.1:${port}`;
    child=spawn(process.execPath,['server-node.js'],{cwd:temp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TRACKING_RPA_ENABLED:'false'},stdio:'ignore'});
    await until(async()=>{try{return (await fetch(base+'/api/health')).ok;}catch{return false;}});
    const read=()=>JSON.parse(fs.readFileSync(dbFile,'utf8'));
    await until(()=>read().shipments.find(item=>item.id==='SH-1').status==='مرتجع',120);
    let db=read();const byId=id=>db.shipments.find(item=>item.id===id);
    assert.deepEqual([byId('SH-1').status,byId('SH-1').normalizedStatus,byId('SH-1').shippingStatus,byId('SH-1').trackingStatus],['مرتجع','returned','returned','returned']);
    assert.equal(byId('SH-1').refusedAt,'2026-10-27T10:00:00.000Z');
    console.log('PASS a refused order shows its parcel as a return (fixed once at start-up)');
    assert.equal(byId('SH-2').status,'ملغاة');assert.equal(byId('SH-2').shippingStatus,'cancelled');
    assert.equal(byId('SH-4').status,'في مرحلة نقل','an open order keeps its parcel as tracked');
    assert.equal(byId('SH-5').status,'تم التسليم','a delivered parcel is not cancelled afterwards');
    console.log('PASS a cancelled order cancels its parcel; open and delivered parcels are left alone');

    // A later save of an old page copy that still shows the parcel in transit does not undo it.
    const token=(await (await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password})})).json()).token;
    const page=await (await fetch(base+'/api/db',{headers:{'X-Session-Token':token}})).json();
    Object.assign(page.shipments.find(item=>item.id==='SH-1'),transit);
    const response=await fetch(base+'/api/db',{method:'PUT',headers:{'X-Session-Token':token,'Content-Type':'application/json','If-Match':String(page.meta.dataRevision)},body:JSON.stringify(page)});
    assert.equal(response.status,200,await response.clone().text());
    db=read();assert.equal(byId('SH-1').status,'مرتجع');
    console.log('PASS a save that still shows the old status keeps the parcel a return');
  }finally{
    if(child)child.kill();
    fs.rmSync(temp,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
