#!/usr/bin/env node
"use strict";

const fs=require("fs");
const os=require("os");
const path=require("path");
const {spawn}=require("child_process");

const root=path.resolve(__dirname,".."),qa=fs.mkdtempSync(path.join(os.tmpdir(),"dotcom-fulfillment-"));
fs.cpSync(path.join(root,"server-node.js"),path.join(qa,"server-node.js"));
fs.cpSync(path.join(root,"app"),path.join(qa,"app"),{recursive:true});
fs.cpSync(path.join(root,"data"),path.join(qa,"data"),{recursive:true});
const dbPath=path.join(qa,"data","database.json"),db=JSON.parse(fs.readFileSync(dbPath,"utf8"));
const customer=(db.customers||[]).find(x=>!x.deletedAt)||{id:"C-QA",name:"عميل QA",phone:"01000000000"};
const book=(db.books||[]).find(x=>!x.deletedAt&&Number(x.stock||0)-Number(x.reservedStock||0)>=3)||(db.books||[]).find(x=>!x.deletedAt)||{id:"B-QA",name:"كتاب QA"};
const company=(db.shippingCompanies||[]).find(x=>!x.deletedAt&&x.active!==false)?.name;
if(!company)throw new Error("No active shipping company fixture.");
db.onlineOrders=db.onlineOrders||[];db.sales=db.sales||[];db.shipments=db.shipments||[];
const now=new Date().toISOString();
function fixture(index,{paid=0,stage="awaiting_shipping",prepared=true}={}){
  const orderId=`ORD-WF-${String(index).padStart(2,"0")}`,saleId=`INV-WF-${String(index).padStart(2,"0")}`,total=670;
  const order={id:orderId,date:now.slice(0,10),customerId:customer.id,customerName:customer.name,phone:customer.phone||"01000000000",governorate:"القاهرة",city:"مدينة نصر",address:"عنوان QA",source:"whatsapp",status:prepared?"تم التجهيز":"قيد التجهيز",workflowStage:stage,confirmedAt:now,confirmedBy:"QA",preparedAt:prepared?now:null,preparedBy:prepared?"QA":null,lines:[{bookId:book.id,qty:1,price:600,discount:0,discountType:"percent"}],shippingCost:70,subtotal:600,discountTotal:0,total,paidAmount:paid,amountDueAtDelivery:total-paid,saleId,createdAt:now,updatedAt:now,deletedAt:null};
  const sale={id:saleId,date:now.slice(0,10),customerId:customer.id,onlineOrderId:orderId,total,shipping:70,paid,paidAmount:paid,remaining:total-paid,remainingAmount:total-paid,customerSnapshot:{name:customer.name,phone:customer.phone||"01000000000",governorate:"القاهرة",city:"مدينة نصر",address:"عنوان QA"},lines:order.lines,createdAt:now,updatedAt:now,deletedAt:null};
  db.onlineOrders.push(order);db.sales.push(sale);return order;
}
const prep=fixture(0,{stage:"awaiting_preparation",prepared:false});
for(let i=1;i<=10;i++)fixture(i,{paid:i===1?670:i===2?200:0});
fs.writeFileSync(dbPath,JSON.stringify(db,null,2));

const port=8935,child=spawn(process.execPath,["server-node.js"],{cwd:qa,env:{...process.env,PORT:String(port),HOST:"127.0.0.1",TRACKING_RPA_ENABLED:"false"},stdio:["ignore","pipe","pipe"]});
let output="";child.stdout.on("data",d=>output+=d);child.stderr.on("data",d=>output+=d);
const base=`http://127.0.0.1:${port}`;let token="";
const pass=(ok,label)=>{if(!ok)throw new Error(label);console.log(`PASS ${label}`);};
async function call(route,{method="GET",body}={}){
  const response=await fetch(base+route,{method,headers:{...(token?{"X-Session-Token":token}:{}),...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
  return {status:response.status,body:await response.json().catch(()=>({}))};
}
async function wait(){
  for(let i=0;i<60;i++){try{const r=await fetch(base+"/");if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}
  throw new Error(`Server did not start: ${output}`);
}
(async()=>{
  await wait();
  const login=await call("/api/login",{method:"POST",body:{username:"owner",password:process.env.DOTCOM_TEST_PASSWORD||"DotCom@2026"}});token=login.body.token;pass(login.status===200,"owner login");
  const editPayload={phone:`010${String(Date.now()).slice(-8)}`,customerName:"عميل تعديل التجهيز",governorate:"القاهرة",address:"QA",chatwootConversationId:`wf-edit-${Date.now()}`,lines:[{bookId:book.id,qty:1,discount:0,discountType:"percent"}],shippingCost:70,paymentPlan:"cash_on_delivery",paidAmount:0,paymentConfirmed:false};
  const created=await call("/api/orders/quick",{method:"POST",body:editPayload}),editId=created.body.order?.id;pass(created.status===201&&editId,"editable order created");
  await call(`/api/orders/${editId}/confirm`,{method:"POST"});await call(`/api/orders/${editId}/prepare/start`,{method:"POST"});await call(`/api/orders/${editId}/prepare/checklist`,{method:"PATCH",body:{doneBookIds:[book.id]}});
  const edited=await call(`/api/orders/${editId}/quick`,{method:"PATCH",body:{...editPayload,lines:[{bookId:book.id,qty:2,discount:0,discountType:"percent"}]}});
  pass(edited.status===200&&edited.body.preparationReset&&edited.body.order.lines[0].qty===2&&edited.body.order.preparationChecklist[0].qty===2&&!edited.body.order.preparationChecklist[0].done,"edit during preparation updates source order and checklist");
  pass(edited.body.order.inventoryReservation?.lines?.[0]?.qty===2,"edit updates inventory reservation atomically");
  pass((await call(`/api/orders/${prep.id}/prepare/start`,{method:"POST"})).status===200,"start preparation");
  pass((await call(`/api/orders/${prep.id}/prepare/checklist`,{method:"PATCH",body:{doneBookIds:[book.id]}})).status===200,"checklist reads current order item");
  const completed=await call(`/api/orders/${prep.id}/prepare/complete`,{method:"POST"});
  pass(completed.status===200&&completed.body.order.workflowStage==="awaiting_shipping"&&completed.body.order.preparedAt,"complete moves directly to ready shipping");
  pass((await call(`/api/orders/${prep.id}/prepare/start`,{method:"POST"})).status===409,"prepared order cannot start preparation again");
  const reopened=await call(`/api/orders/${prep.id}/prepare/reopen`,{method:"POST"});
  pass(reopened.status===200&&reopened.body.order.workflowStage==="awaiting_preparation"&&!reopened.body.order.preparedAt,"explicit reopen returns order to preparation");
  const rows=Array.from({length:10},(_,i)=>({orderId:`ORD-WF-${String(i+1).padStart(2,"0")}`,trackingNumber:`WF${String(i+1).padStart(10,"0")}EG`}));
  const batch=await call("/api/orders/shipping/batch",{method:"POST",body:{company,rows}});
  pass(batch.status===200&&batch.body.results.filter(x=>x.ok).length===10,"10 ready orders shipped in one batch");
  const after=(await call("/api/db")).body;
  const full=after.shipments.find(x=>x.onlineOrderId==="ORD-WF-01"),partial=after.shipments.find(x=>x.onlineOrderId==="ORD-WF-02");
  pass(full.amountDueAtDelivery===0&&full.collectionAmount===0,"fully paid order COD is zero");
  pass(partial.amountDueAtDelivery===470&&partial.collectionAmount===470,"partially paid order COD equals remaining");
  const duplicate=await call("/api/orders/shipping/batch",{method:"POST",body:{company,rows:[{orderId:"ORD-WF-01",trackingNumber:"WF0000000001EG"},{orderId:"ORD-WF-02",trackingNumber:"WF0000000001EG"}]}});
  pass(duplicate.body.results.every(x=>!x.ok),"already shipped orders and duplicate attempts are rejected");
  pass(after.onlineOrders.filter(x=>/^ORD-WF-0[1-9]$|^ORD-WF-10$/.test(x.id)).every(x=>x.workflowStage==="shipped"&&x.shipmentId),"shipped orders leave ready queue persistently");
  console.log("Fulfillment workflow QA complete.");
})().catch(error=>{console.error(`FAIL ${error.message}`);process.exitCode=1;}).finally(()=>{child.kill("SIGTERM");setTimeout(()=>fs.rmSync(qa,{recursive:true,force:true}),50);});
