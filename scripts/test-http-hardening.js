'use strict';
// Request body limits, malformed JSON, fail-closed login on a corrupt database, security headers and static containment.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),http=require('node:http'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(50);}throw new Error('Timed out waiting for server');}
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
async function startServer(temp){
 const port=await freePort(),base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server-node.js'],{cwd:temp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TRACKING_RPA_ENABLED:'false'},stdio:'ignore'});
 await until(async()=>{try{return (await fetch(base+'/api/health')).ok;}catch{return false;}});
 return {child,base,port};
}
function workspace(name){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),name));
 fs.cpSync('app',path.join(temp,'app'),{recursive:true});fs.copyFileSync('server-node.js',path.join(temp,'server-node.js'));fs.mkdirSync(path.join(temp,'data'));
 return temp;
}
// Raw request so the exact path and an oversized body are sent as-is.
function raw(port,{method='GET',path:requestPath='/',headers={},body}={}){
 return new Promise(resolve=>{
  const req=http.request({host:'127.0.0.1',port,method,path:requestPath,headers},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});
  req.on('error',error=>resolve({error:error.code}));
  if(body)req.end(body);else req.end();
 });
}
(async()=>{
 const temps=[],children=[];
 try {
  const temp=workspace('http-hardening-');temps.push(temp);
  const salt='s',password='test-password',dbFile=path.join(temp,'data/database.json');
  fs.writeFileSync(dbFile,JSON.stringify({version:4,meta:{dataRevision:0},
   users:[{id:'U1',username:'owner',name:'Owner',role:'مالك',active:true,salt,passwordHash:crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')}],
   settings:{tracking:{enabled:false}},audit:[],sales:[],books:[],shippingCompanies:[{id:'SC-001',name:'البريد المصري',active:true}]}));
  // A sibling directory whose name starts with the static root's name (…/app-dist next to …/app).
  fs.mkdirSync(path.join(temp,'app-dist'));fs.writeFileSync(path.join(temp,'app-dist','secret.txt'),'sibling secret');
  const server=await startServer(temp);children.push(server.child);
  const json=(route,{token,method='POST',body}={})=>fetch(server.base+route,{method,headers:{'Content-Type':'application/json',...(token?{'X-Session-Token':token}:{})},body});

  // Malformed JSON on login is a 400, and the server keeps serving.
  let r=await json('/api/login',{body:'{"username":"owner",'});
  assert.equal(r.status,400);assert.equal((await r.json()).code,'INVALID_JSON');
  r=await json('/api/login',{body:'null'});assert.equal(r.status,400);
  const token=(await (await json('/api/login',{body:JSON.stringify({username:'owner',password})})).json()).token;
  assert.ok(token,'login still works after malformed requests');
  console.log('PASS malformed login JSON returns 400 instead of 500');

  // Oversized bodies are refused with 413 (declared Content-Length and streamed without one).
  const big=Buffer.alloc(20*1024,'a');
  let rr=await raw(server.port,{method:'POST',path:'/api/login',headers:{'Content-Type':'application/json','Content-Length':big.length},body:big});
  assert.equal(rr.status,413,JSON.stringify(rr));assert.equal(JSON.parse(rr.text).code,'PAYLOAD_TOO_LARGE');
  rr=await new Promise(resolve=>{const req=http.request({host:'127.0.0.1',port:server.port,method:'POST',path:'/api/login',headers:{'Content-Type':'application/json','Transfer-Encoding':'chunked'}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,text}));});req.on('error',error=>resolve({error:error.code}));req.write(big.subarray(0,10*1024));setTimeout(()=>req.end(big.subarray(0,10*1024)),50);});
  assert.equal(rr.status,413,JSON.stringify(rr));
  console.log('PASS login bodies over 16 KB are refused with 413');
  const quickBody=JSON.stringify({phone:'01012345678',customerName:'x',governorate:'القاهرة',address:'x',lines:[],notes:'n'.repeat(1100*1024)});
  rr=await raw(server.port,{method:'POST',path:'/api/orders/quick',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(quickBody),'X-Session-Token':token},body:quickBody});
  assert.equal(rr.status,413,JSON.stringify(rr).slice(0,300));
  console.log('PASS ordinary API bodies over 1 MB are refused with 413');
  const dbResponse=await fetch(server.base+'/api/db',{headers:{'X-Session-Token':token}}),db=await dbResponse.json();
  db.settings.companyNote='x'.repeat(2*1024*1024);
  r=await fetch(server.base+'/api/db',{method:'PUT',headers:{'X-Session-Token':token,'Content-Type':'application/json','If-Match':dbResponse.headers.get('x-db-revision')},body:JSON.stringify(db)});
  assert.equal(r.status,200,'a whole-database save above 1 MB is still accepted (64 MB limit)');
  assert.equal((await (await fetch(server.base+'/api/health')).json()).ok,true,'server alive after oversized requests');
  console.log('PASS PUT /api/db accepts multi-megabyte saves');

  // Security headers.
  r=await fetch(server.base+'/api/health');
  assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal(r.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
  assert.equal(r.headers.get('x-frame-options'),null,'JSON is not given frame headers');
  r=await fetch(server.base+'/');
  assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/html/);
  assert.equal(r.headers.get('content-security-policy'),"script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");assert.equal(r.headers.get('x-frame-options'),'SAMEORIGIN');
  assert.equal(r.headers.get('x-content-type-options'),'nosniff');
  r=await fetch(server.base+'/styles.css');assert.equal(r.headers.get('x-content-type-options'),'nosniff');
  r=await fetch(server.base+'/missing-file.txt');assert.equal(r.status,404);assert.equal(r.headers.get('x-content-type-options'),'nosniff');
  console.log('PASS every response carries nosniff and Referrer-Policy; HTML pages may only be framed by the system');

  // Static files: a sibling directory sharing the root's name prefix is not reachable.
  rr=await raw(server.port,{path:'/..%2fapp-dist/secret.txt'});
  assert.equal(rr.status,404,'sibling directory is not served');assert.equal(rr.text.includes('sibling secret'),false);
  rr=await raw(server.port,{path:'/..%2fdata/database.json'});assert.equal(rr.status,404);
  assert.equal((await fetch(server.base+'/app.js')).status,200,'normal static files are still served');
  console.log('PASS static files are contained inside the app directory');

  // A corrupt database must not re-enable the documented default accounts.
  const corrupt=workspace('http-hardening-corrupt-');temps.push(corrupt);
  fs.writeFileSync(path.join(corrupt,'data/database.json'),'{"users":[');
  const corruptServer=await startServer(corrupt);children.push(corruptServer.child);
  r=await fetch(corruptServer.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:'DotCom@2026'})});
  assert.equal(r.status,401,'default credentials are refused while database.json is unreadable');
  console.log('PASS login fails closed when database.json is corrupt');
  console.log('PASS HTTP hardening checks completed');
 } finally {
  for(const child of children)child.kill();
  for(const temp of temps)fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
