#!/usr/bin/env node
"use strict";
const fs=require("fs"),os=require("os"),path=require("path"),crypto=require("crypto"),{spawn}=require("child_process");
const root=path.resolve(__dirname,".."),qa=fs.mkdtempSync(path.join(os.tmpdir(),"dotcom-shipping-permission-"));
fs.cpSync(path.join(root,"server-node.js"),path.join(qa,"server-node.js"));
fs.cpSync(path.join(root,"app"),path.join(qa,"app"),{recursive:true});
fs.cpSync(path.join(root,"data"),path.join(qa,"data"),{recursive:true});
const dbPath=path.join(qa,"data/database.json"),db=JSON.parse(fs.readFileSync(dbPath,"utf8"));
const customer=(db.customers||[]).find(row=>!row.deletedAt&&/^01\d{9}$/.test(String(row.phone||"")));
const book=(db.books||[]).find(row=>!row.deletedAt&&Number(row.stock||0)>=2&&Number(row.price||0)>0);
if(!customer||!book)throw new Error("Shipping permission fixture is incomplete.");
const unit=Number(book.price),threshold=unit*1.5;
db.settings=db.settings||{};db.settings.shippingRules={byGovernorate:{القاهرة:50},activeByGovernorate:{القاهرة:true},defaultCost:20,freeShippingAbove:threshold};
fs.writeFileSync(dbPath,JSON.stringify(db,null,2));
const port=8947,child=spawn(process.execPath,["server-node.js"],{cwd:qa,env:{...process.env,PORT:String(port),HOST:"127.0.0.1",TRACKING_RPA_ENABLED:"false"},stdio:["ignore","pipe","pipe"]});
let output="";child.stdout.on("data",chunk=>output+=chunk);child.stderr.on("data",chunk=>output+=chunk);
const base=`http://127.0.0.1:${port}`,pass=(ok,label)=>{if(!ok)throw new Error(label);console.log(`PASS ${label}`);};
async function wait(){for(let i=0;i<60;i++){try{if((await fetch(base+"/api/health")).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}throw new Error(output||"Server failed to start.");}
async function call(route,{method="GET",body,token=""}={}){const response=await fetch(base+route,{method,headers:{...(token?{"X-Session-Token":token}:{}),...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});return{status:response.status,body:await response.json().catch(()=>({}))};}
async function login(username){const result=await call("/api/login",{method:"POST",body:{username,password:process.env.DOTCOM_TEST_PASSWORD||"DotCom@2026"}});if(result.status!==200)throw new Error(`${username} login failed`);return result.body.token;}
function payload({qty=1,shippingCost=50,suffix=""}={}){return{phone:customer.phone,customerName:customer.name,governorate:"القاهرة",city:customer.city||"QA",address:customer.address||"QA",chatwootConversationId:`shipping-permission-${suffix}-${Date.now()}-${crypto.randomUUID()}`,lines:[{bookId:book.id,qty}],shippingCost};}
(async()=>{
  await wait();const cashier=await login("cashier"),owner=await login("owner");
  const automatic=await call("/api/orders/quick",{method:"POST",token:cashier,body:payload({shippingCost:50,suffix:"automatic"})});
  pass(automatic.status===201&&automatic.body.order.shippingCost===50,"automatic governorate shipping works without override permission");
  const free=await call("/api/orders/quick",{method:"POST",token:cashier,body:payload({qty:2,shippingCost:0,suffix:"free"})});
  pass(free.status===201&&free.body.order.shippingCost===0,"automatic free shipping needs no override permission");
  const before=fs.readFileSync(dbPath,"utf8"),denied=await call("/api/orders/quick",{method:"POST",token:cashier,body:payload({shippingCost:99,suffix:"denied"})});
  pass(denied.status===403&&denied.body.code==="SHIPPING_OVERRIDE_FORBIDDEN","manual shipping override is rejected without permission");
  pass(fs.readFileSync(dbPath,"utf8")===before,"rejected override does not change data");
  const allowed=await call("/api/orders/quick",{method:"POST",token:owner,body:payload({shippingCost:99,suffix:"owner"})});
  pass(allowed.status===201&&allowed.body.order.shippingCost===99,"owner can apply a manual shipping override");
  console.log("5/5 shipping override permission tests passed");
})().catch(error=>{console.error(`FAIL ${error.message}`);process.exitCode=1;}).finally(()=>{child.kill("SIGTERM");setTimeout(()=>fs.rmSync(qa,{recursive:true,force:true}),50);});
