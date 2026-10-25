#!/usr/bin/env node
"use strict";
const assert=require("assert/strict"),fs=require("fs"),os=require("os"),path=require("path"),net=require("net"),crypto=require("crypto"),{spawn}=require("child_process");
const DuplicateOrders=require("../app/duplicate-orders.js");
const pass=label=>console.log(`PASS ${label}`);

// Unit: matching and stages
{
  const now=Date.parse("2026-10-25T12:00:00Z"),day=86400000;
  assert.equal(DuplicateOrders.normalizePhone("+20 101 234 5678"),"01012345678");
  assert.equal(DuplicateOrders.normalizePhone("00201012345678"),"01012345678");
  assert.equal(DuplicateOrders.normalizePhone("١٠١٢٣٤٥٦٧٨"),"01012345678");
  pass("phones in +20, 0020 and Arabic digits are the same number");
  const orders=[
    {id:"ORD-1",phone:"01012345678",customerName:"أحمد علي",governorate:"القاهرة",workflowStage:"preparing",createdAt:new Date(now-day).toISOString()},
    {id:"ORD-2",phone:"01199999999",alternativePhone:"01012345678",customerName:"أحمد",governorate:"الجيزة",workflowStage:"awaiting_shipping",preparedAt:"x"},
    {id:"ORD-3",phone:"01012345678",workflowStage:"shipped",shippedAt:new Date(now-2*day).toISOString()},
    {id:"ORD-4",phone:"01012345678",workflowStage:"shipped",shippedAt:new Date(now-30*day).toISOString()},
    {id:"ORD-5",phone:"01012345678",workflowStage:"cancelled"},
    {id:"ORD-6",phone:"01055555555",customerName:"احمد  علي",governorate:"محافظة القاهرة",workflowStage:"draft"},
    {id:"ORD-7",phone:"01012345678",workflowStage:"delivered"},
    {id:"ORD-8",phone:"01277777777",customerWhatsAppPhone:"01288888888",workflowStage:"awaiting_preparation"},
    {id:"ORD-9",phone:"01266666666",chatwootContactId:"42",workflowStage:"awaiting_stock"}
  ];
  const fromChat=DuplicateOrders.findCustomerOrders(orders,{phone:"01500000000",whatsAppPhone:"01288888888",chatwootContactId:"42"},{now}).map(match=>match.order.id).sort();
  assert.deepEqual(fromChat,["ORD-8","ORD-9"]);
  pass("the chat's WhatsApp number and Chatwood contact match orders placed with another delivery number");
  const matches=DuplicateOrders.findCustomerOrders(orders,{phone:"01012345678",customerName:"أحمد علي",governorate:"القاهرة"},{now});
  const byId=Object.fromEntries(matches.map(match=>[match.order.id,match]));
  assert.deepEqual(Object.keys(byId).sort(),["ORD-1","ORD-2","ORD-3","ORD-6"]);
  assert.equal(byId["ORD-1"].state,"open");assert.equal(byId["ORD-1"].strength,"strong");
  assert.equal(byId["ORD-2"].state,"packed");assert.equal(byId["ORD-2"].label,"مغلّف · منتظر كود التتبع");
  assert.equal(byId["ORD-3"].state,"recent_shipped");
  assert.equal(byId["ORD-6"].strength,"weak");
  assert.deepEqual(DuplicateOrders.blockingMatches(matches).map(match=>match.order.id).sort(),["ORD-1","ORD-2","ORD-6"]);
  pass("open and packed orders block; shipped in the last week is information; cancelled, delivered and old ones are ignored");
  pass("the alternative phone and the same name in the same governorate are matched");
  assert.equal(DuplicateOrders.blockingMatches(DuplicateOrders.findCustomerOrders(orders.slice(2),{phone:"01012345678"},{now})).length,0);
  pass("a recently shipped order alone does not block");
}

// API: the server refuses a second order without a reason
(async()=>{
  const root=path.resolve(__dirname,".."),qa=fs.mkdtempSync(path.join(os.tmpdir(),"duplicate-orders-"));
  let child,output="";
  try{
    fs.cpSync(path.join(root,"server-node.js"),path.join(qa,"server-node.js"));
    fs.cpSync(path.join(root,"app"),path.join(qa,"app"),{recursive:true});
    fs.cpSync(path.join(root,"data"),path.join(qa,"data"),{recursive:true});
    const dbPath=path.join(qa,"data/database.json"),db=JSON.parse(fs.readFileSync(dbPath,"utf8"));
    const book=(db.books||[]).find(row=>!row.deletedAt&&Number(row.stock||0)>=3&&Number(row.price||0)>0);
    if(!book)throw new Error("Fixture has no book in stock.");
    const phone=`015${String(Date.now()).slice(-8)}`;
    const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>resolve(p));});});
    child=spawn(process.execPath,["server-node.js"],{cwd:qa,env:{...process.env,PORT:String(port),HOST:"127.0.0.1",TRACKING_RPA_ENABLED:"false"},stdio:["ignore","pipe","pipe"]});
    child.stdout.on("data",chunk=>output+=chunk);child.stderr.on("data",chunk=>output+=chunk);
    const base=`http://127.0.0.1:${port}`;
    for(let i=0;;i++){try{if((await fetch(base+"/api/health")).ok)break;}catch{}if(i>100)throw new Error(output||"Server failed to start.");await new Promise(r=>setTimeout(r,50));}
    const call=async(route,body,token)=>{const r=await fetch(base+route,{method:"POST",headers:{"Content-Type":"application/json",...(token?{"X-Session-Token":token}:{})},body:JSON.stringify(body)});return{status:r.status,body:await r.json().catch(()=>({}))};};
    const login=await call("/api/login",{username:"owner",password:process.env.DOTCOM_TEST_PASSWORD||"DotCom@2026"});
    assert.equal(login.status,200,"owner login");const token=login.body.token;
    const order=(extra={})=>({phone,customerName:"عميل تكرار QA",governorate:"القاهرة",city:"مدينة نصر",address:"QA",chatwootConversationId:`dup-${crypto.randomUUID()}`,lines:[{bookId:book.id,qty:1}],...extra});
    const first=await call("/api/orders/quick",order(),token);
    assert.equal(first.status,201,JSON.stringify(first.body));
    const before=fs.readFileSync(dbPath,"utf8");
    const second=await call("/api/orders/quick",order({phone:`+2${phone}`}),token);
    assert.equal(second.status,409);assert.equal(second.body.code,"POSSIBLE_DUPLICATE_ORDER");
    assert.equal(second.body.orders[0].id,first.body.order.id);
    assert.equal(fs.readFileSync(dbPath,"utf8"),before);
    pass("a second order for the same phone is refused and nothing is saved");
    const otherChat=await call("/api/orders/quick",order({phone:`012${String(Date.now()).slice(-8)}`}),token);
    assert.equal(otherChat.status,409,"same name and governorate with another phone");
    pass("the same name in the same governorate from another number is refused too");
    const short=await call("/api/orders/quick",order({duplicateOverrideReason:"ok"}),token);
    assert.equal(short.status,409);
    const allowed=await call("/api/orders/quick",order({duplicateOverrideReason:"العميل طالب شحنة منفصلة لعنوان تاني"}),token);
    assert.equal(allowed.status,201,JSON.stringify(allowed.body));
    assert.deepEqual(allowed.body.order.duplicateOverride.matchedOrderIds,[first.body.order.id]);
    assert(allowed.body.order.duplicateOverride.by&&allowed.body.order.duplicateOverride.reason.includes("شحنة منفصلة"));
    const saved=JSON.parse(fs.readFileSync(dbPath,"utf8"));
    assert((saved.audit||[]).some(row=>row.entityId===allowed.body.order.id&&row.action==="تسجيل طلب منفصل رغم وجود طلب مفتوح"));
    pass("with a written reason the order is saved, flagged and audited");
    console.log("8/8 duplicate order tests passed");
  }catch(error){console.error(`FAIL ${error.stack||error.message}\n${output.slice(-2000)}`);process.exitCode=1;}
  finally{child?.kill("SIGTERM");setTimeout(()=>fs.rmSync(qa,{recursive:true,force:true}),100);}
})();
