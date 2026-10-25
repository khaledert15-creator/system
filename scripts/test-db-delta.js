'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const DbDelta=require('../app/db-delta.js');
const hash=value=>crypto.createHash('sha1').update(value).digest('base64');
const clone=value=>JSON.parse(JSON.stringify(value));
const pass=(name,fn)=>{fn();console.log(`PASS ${name}`);};

function sample(){return{meta:{dataRevision:1},settings:{companyName:'A'},governorates:['القاهرة','الجيزة'],books:[{id:'B1',stock:5},{id:'B2',stock:1}],shipments:[{id:'S1',status:'جديدة'},{id:'S2',status:'جديدة'},{id:'S3',status:'جديدة'}],audit:[{id:'A1'}],noIds:[{name:'x'}]};}
// The page's copy must end up exactly like a full download of the new state.
function roundTrip(before,after,mutateBase=x=>x){
  const tracker=DbDelta.createTracker({hash});tracker.observe('1',before);tracker.observe('2',after);
  const delta=tracker.changesSince('1',after);assert(delta,'delta expected');
  const applied=DbDelta.applyDelta(mutateBase(clone(before)),delta);
  return {delta,applied};
}

pass('Only changed records are sent and the result equals the new state',()=>{
  const before=sample(),after=clone(before);after.shipments[1].status='تم التسليم';after.meta.dataRevision=2;
  const {delta,applied}=roundTrip(before,after);
  assert.deepEqual(Object.keys(delta.changes).sort(),['meta','shipments']);
  assert.deepEqual(delta.changes.shipments.upsert.map(row=>row.id),['S2']);
  assert.equal(delta.changes.shipments.order,undefined);
  assert.deepEqual(applied,after);assert(DbDelta.countsMatch(applied,delta.counts));
});

pass('Added, removed and reordered records and whole values come out in server order',()=>{
  const before=sample(),after=clone(before);
  after.shipments=[after.shipments[2],{id:'S4',status:'x'},after.shipments[0]];after.books.push({id:'B3',stock:9});
  after.settings.companyName='B';after.noIds.push({name:'y'});after.audit.push({id:'A2'});delete after.governorates;after.newList=[{id:'N1'}];
  const {delta,applied}=roundTrip(before,after);
  assert(delta.changes.shipments.order,'reorder must send the order');
  assert.equal(delta.changes.books.order,undefined);
  assert.deepEqual(delta.changes.governorates,{deleted:true});
  assert.deepEqual(applied,after);
});

pass('Changes across several revisions are merged',()=>{
  const tracker=DbDelta.createTracker({hash});const s1=sample(),s2=clone(s1),s3=clone(s1);
  s2.books[0].stock=4;s3.books[0].stock=4;s3.books=s3.books.filter(row=>row.id!=='B2');s3.shipments[0].status='y';
  tracker.observe('1',s1);tracker.observe('2',s2);tracker.observe('3',s3);
  const delta=tracker.changesSince('1',s3);assert.deepEqual(DbDelta.applyDelta(clone(s1),delta),s3);
  assert.deepEqual(DbDelta.applyDelta(clone(s2),tracker.changesSince('2',s3)),s3);
  assert.deepEqual(tracker.changesSince('3',s3).changes,{});
});

pass('Unknown or forgotten revisions ask for a full load',()=>{
  const tracker=DbDelta.createTracker({hash,historyLimit:2});const s=sample();
  assert.equal(tracker.changesSince('1',s),null);
  tracker.observe('1',s);for(let r=2;r<=5;r+=1){const next=clone(s);next.meta.dataRevision=r;tracker.observe(String(r),next);}
  assert.equal(tracker.changesSince('1',s),null);assert.equal(tracker.changesSince('99',s),null);assert(tracker.changesSince('3',s));
});

pass('A page copy that drifted from the server is caught by the counts',()=>{
  const before=sample(),after=clone(before);after.audit.push({id:'A-server'});
  // The page saved an audit row the server stored under another id: counts no longer match.
  const {delta,applied}=roundTrip(before,after,base=>{base.audit.push({id:'A-local'});return base;});
  assert.equal(DbDelta.countsMatch(applied,delta.counts),false);
});

pass('Defaults the page adds to its lists are allowed for',()=>{
  const server={shippingCompanies:[{id:'SC1'}]},page={shippingCompanies:[{id:'SC1'},{id:'SC-default'}]};
  const drift=DbDelta.countDrift(server,page);assert.deepEqual(drift,{shippingCompanies:1});
  assert(DbDelta.countsMatch(page,{shippingCompanies:1},drift));assert(!DbDelta.countsMatch(page,{shippingCompanies:2},drift));
});

pass('Lists without unique ids are tracked as one value',()=>{
  assert.equal(DbDelta.recordIds([{id:'1'},{id:'1'}]),null);assert.equal(DbDelta.recordIds([{id:''}]),null);assert.equal(DbDelta.recordIds(['a']),null);
  assert.deepEqual(DbDelta.recordIds([{id:1},{id:'2'}]),['1','2']);
});

(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'db-delta-'));let child;
  try{
    fs.cpSync('app',path.join(temp,'app'),{recursive:true});fs.copyFileSync('server-node.js',path.join(temp,'server-node.js'));fs.mkdirSync(path.join(temp,'data'));
    if(fs.existsSync('scripts/build-static-assets.js')){fs.mkdirSync(path.join(temp,'scripts'));fs.copyFileSync('scripts/build-static-assets.js',path.join(temp,'scripts/build-static-assets.js'));}
    const salt='test-salt',password='test-password';
    const runs=[{id:'R1',shipmentId:'SH1',finishedAt:'2026-10-01T10:00:00Z'},{id:'R2',shipmentId:'SH1',finishedAt:'2026-10-02T10:00:00Z'},{id:'R3',shipmentId:'SH2',finishedAt:'2026-10-01T10:00:00Z'}];
    fs.writeFileSync(path.join(temp,'data/database.json'),JSON.stringify({version:4,meta:{dataRevision:0},users:[{id:'U1',username:'owner',name:'Owner',role:'مالك',active:true,salt,passwordHash:crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')}],books:[{id:'B1',name:'كتاب',stock:3}],sales:[],settings:{},shipments:[{id:'SH1',status:'جديدة'},{id:'SH2',status:'جديدة'}],trackingRuns:runs,trackingRunBatches:[{id:'TB1'}]}));
    const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
    const base=`http://127.0.0.1:${port}`;
    child=spawn(process.execPath,['server-node.js'],{cwd:temp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TRACKING_RPA_ENABLED:'false',NODE_ENV:'test'},stdio:'ignore'});
    for(let i=0;i<100;i+=1){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
    assert.equal((await fetch(base+'/api/db/delta?since=0')).status,401);
    const token=(await (await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password})})).json()).token;
    const headers={'X-Session-Token':token};
    const first=await fetch(base+'/api/db',{headers});const page=await first.json(),revision=first.headers.get('X-DB-Revision');
    assert.deepEqual(page.trackingRuns.map(row=>row.id),['R2','R3']);assert.equal(page.trackingRunBatches,undefined);
    assert.equal(page.users[0].passwordHash,undefined);
    console.log('PASS pages get the latest tracking run per shipment and no credentials');

    const same=await (await fetch(`${base}/api/db/delta?since=${revision}`,{headers})).json();
    assert.equal(same.mode,'delta');assert.deepEqual(same.changes,{});

    // A save (as a page does) then a change made by the server itself.
    const next=clone(page);next.books[0].stock=7;next.shipments[1].status='خرج للتوصيل';
    const put=await fetch(base+'/api/db',{method:'PUT',headers:{...headers,'Content-Type':'application/json','If-Match':revision},body:JSON.stringify(next)});
    assert.equal(put.status,200,await put.text());
    const delta=await (await fetch(`${base}/api/db/delta?since=${revision}`,{headers})).json();
    const full=await (await fetch(base+'/api/db',{headers})).json();
    assert.equal(delta.mode,'delta');
    assert(!('trackingRuns' in delta.changes),'the save must not resend tracking runs');
    assert.deepEqual(delta.changes.books.upsert.map(row=>row.stock),[7]);
    assert.deepEqual(DbDelta.applyDelta(page,delta),full);
    console.log('PASS a refresh after a save gets only the changes and ends equal to a full download');

    const unknown=await (await fetch(`${base}/api/db/delta?since=999`,{headers})).json();
    assert.equal(unknown.mode,'full');assert.deepEqual(unknown.data,full);
    console.log('PASS an unknown revision gets the whole database in the same reply');
  }finally{if(child){child.kill();await new Promise(r=>child.once('exit',r));}fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
