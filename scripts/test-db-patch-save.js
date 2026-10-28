'use strict';
// POST /api/db/patch saves only the records a page changed. Changes others made after the page's revision are kept,
// a change to the same record is refused, an unknown revision asks for a full save, and PUT's checks still apply.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(50);}throw new Error('Timed out waiting for server');}
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'db-patch-'));let child;
 try {
  fs.cpSync('app',path.join(temp,'app'),{recursive:true});fs.copyFileSync('server-node.js',path.join(temp,'server-node.js'));fs.mkdirSync(path.join(temp,'data'));
  const salt='s',password='test-password',dbFile=path.join(temp,'data/database.json');
  const passwordHash=crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');
  fs.writeFileSync(dbFile,JSON.stringify({version:4,meta:{dataRevision:3},
   users:[{id:'U1',username:'owner',name:'Owner',role:'مالك',active:true,salt,passwordHash}],
   settings:{companyName:'before',tracking:{enabled:false}},audit:[],sales:[],cash:[],purchases:[],
   suppliers:[{id:'S1',name:'مورد',balance:0}],
   books:[{id:'B1',name:'كتاب ١',stock:1,price:10},{id:'B2',name:'كتاب ٢',stock:1,price:10}]}));
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['server-node.js'],{cwd:temp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TRACKING_RPA_ENABLED:'false'},stdio:'ignore'});
  await until(async()=>{try{return (await fetch(base+'/api/health')).ok;}catch{return false;}});
  const token=(await (await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password})})).json()).token;
  const headers={'X-Session-Token':token,'Content-Type':'application/json'};
  const patch=body=>fetch(base+'/api/db/patch',{method:'POST',headers,body:JSON.stringify(body)});
  const stored=()=>JSON.parse(fs.readFileSync(dbFile,'utf8'));

  // The page loads revision 3.
  let response=await fetch(base+'/api/db',{headers});
  const page=await response.json();
  assert.equal(response.headers.get('x-db-revision'),'3');

  // Another screen renames B2 (revision 4).
  const other=JSON.parse(JSON.stringify(page));other.books[1].name='كتاب ٢ معدل';
  response=await fetch(base+'/api/db',{method:'PUT',headers:{...headers,'If-Match':'3'},body:JSON.stringify(other)});
  assert.equal(response.status,200,await response.clone().text());

  // The page, still on revision 3, records a purchase waiting for inspection: new purchase, supplier balance, audit row.
  const purchase={id:'PUR-0001',date:'2026-10-28',supplierId:'S1',type:'شراء',status:'بانتظار الفحص',total:50,paid:0,remaining:50,lines:[{bookId:'B1',productId:'B1',qty:5,quantity:5,cost:10,unitPurchaseCost:10}]};
  response=await patch({baseRevision:'3',collections:{purchases:{upsert:[purchase],remove:[]},suppliers:{upsert:[{id:'S1',name:'مورد',balance:50}],remove:[]},audit:{upsert:[{id:'AUD-'+crypto.randomUUID(),action:'PURCHASE_CREATED',entityId:'PUR-0001'}],remove:[]},users:{upsert:[{id:'U1',username:'owner',role:'كاشير'}],remove:[]}},values:{}});
  assert.equal(response.status,200,await response.clone().text());
  assert.equal(response.headers.get('x-db-revision'),'5');
  let db=stored();
  assert.equal(db.purchases.length,1);assert.equal(db.suppliers[0].balance,50);assert.equal(db.audit.length,1);
  assert.equal(db.books[1].name,'كتاب ٢ معدل','the other screen\'s change is kept');
  assert.equal(db.users[0].role,'مالك');assert.equal(db.users[0].passwordHash,passwordHash,'a patch cannot touch accounts');
  console.log('PASS a patch from an older revision saves and keeps changes made meanwhile');

  // Changing B2 from revision 3 collides with the rename.
  response=await patch({baseRevision:'3',collections:{books:{upsert:[{id:'B2',name:'كتاب ٢',stock:7,price:10}],remove:[]}},values:{}});
  assert.equal(response.status,409);assert.equal((await response.json()).code,'DATABASE_WRITE_BLOCKED_STALE_REVISION');
  assert.equal(stored().books[1].stock,1);
  console.log('PASS a patch to a record someone else changed is refused');

  // A whole value (settings) changed by nobody else is saved; an unknown revision asks for a full save.
  response=await patch({baseRevision:'5',collections:{},values:{settings:{...db.settings,companyName:'after'}}});
  assert.equal(response.status,200,await response.clone().text());
  assert.equal(stored().settings.companyName,'after');
  response=await patch({baseRevision:'999',collections:{},values:{}});
  assert.equal(response.status,409);assert.equal((await response.json()).code,'PATCH_BASE_UNKNOWN');
  console.log('PASS whole values patch, and an unknown revision is answered with PATCH_BASE_UNKNOWN');

  // The whole-database checks still run: a received purchase with no stock or batch is refused.
  const revision=stored().meta.dataRevision;
  await fetch(base+'/api/db/delta?since=5',{headers});
  response=await patch({baseRevision:String(revision),collections:{purchases:{upsert:[{...purchase,id:'PUR-0002',status:'مستلمة'}],remove:[]}},values:{}});
  assert.equal(response.status,409,await response.clone().text());
  assert.match((await response.json()).code,/PURCHASE/);
  assert.equal(stored().purchases.length,1);
  console.log('PASS purchase inventory validation still applies to patches');
  console.log('PASS POST /api/db/patch checks completed');
 } finally {
  if(child)child.kill();
  fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
