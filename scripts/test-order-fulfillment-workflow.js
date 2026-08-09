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
function fixture(index,{paid=0,stage="awaiting_shipping",prepared=true,withSale=true}={}){
  const orderId=`ORD-WF-${String(index).padStart(2,"0")}`,saleId=`INV-WF-${String(index).padStart(2,"0")}`,total=670;
  const order={id:orderId,date:now.slice(0,10),customerId:customer.id,customerName:customer.name,phone:customer.phone||"01000000000",governorate:"القاهرة",city:"مدينة نصر",address:"عنوان QA",source:"whatsapp",status:prepared?"تم التجهيز":"قيد التجهيز",workflowStage:stage,confirmedAt:now,confirmedBy:"QA",preparedAt:prepared?now:null,preparedBy:prepared?"QA":null,lines:[{bookId:book.id,qty:1,price:600,discount:0,discountType:"percent"}],shippingCost:70,subtotal:600,discountTotal:0,total,paidAmount:paid,amountDueAtDelivery:total-paid,saleId,createdAt:now,updatedAt:now,deletedAt:null};
  const sale={id:saleId,date:now.slice(0,10),customerId:customer.id,onlineOrderId:orderId,total,shipping:70,paid,paidAmount:paid,remaining:total-paid,remainingAmount:total-paid,customerSnapshot:{name:customer.name,phone:customer.phone||"01000000000",governorate:"القاهرة",city:"مدينة نصر",address:"عنوان QA"},lines:order.lines,createdAt:now,updatedAt:now,deletedAt:null};
  db.onlineOrders.push(order);if(withSale)db.sales.push(sale);else order.saleId=null;return order;
}
const prep=fixture(0,{stage:"awaiting_preparation",prepared:false});
for(let i=1;i<=10;i++)fixture(i,{paid:i===1?670:i===2?200:0});
const cancellable=fixture(11,{stage:"awaiting_preparation",prepared:false,withSale:false});
const settledCancellable=fixture(12,{paid:670,stage:"awaiting_preparation",prepared:false,withSale:false});
db.orderPayments=db.orderPayments||[];db.cashAccounts=db.cashAccounts||[];
const refundCashAccount=db.cashAccounts.find(row=>!row.deletedAt&&row.active!==false)||{id:"CA-WF",name:"QA Cash",active:true};
if(!db.cashAccounts.some(row=>row.id===refundCashAccount.id))db.cashAccounts.push(refundCashAccount);
db.orderPayments.push({id:"PAY-WF-12",orderId:settledCancellable.id,customerId:settledCancellable.customerId,amount:670,status:"confirmed",confirmed:true,cashAccountId:refundCashAccount.id,cashAccountName:refundCashAccount.name,receivedAt:now});
fs.writeFileSync(dbPath,JSON.stringify(db,null,2));

const port=8935,child=spawn(process.execPath,["server-node.js"],{cwd:qa,env:{...process.env,PORT:String(port),HOST:"127.0.0.1",TRACKING_RPA_ENABLED:"false"},stdio:["ignore","pipe","pipe"]});
let output="";child.stdout.on("data",d=>output+=d);child.stderr.on("data",d=>output+=d);
const base=`http://127.0.0.1:${port}`;let token="";
const pass=(ok,label)=>{if(!ok)throw new Error(label);console.log(`PASS ${label}`);};
async function call(route,{method="GET",body,authToken=token}={}){
  const response=await fetch(base+route,{method,headers:{...(authToken?{"X-Session-Token":authToken}:{}),...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
  return {status:response.status,body:await response.json().catch(()=>({}))};
}
async function wait(){
  for(let i=0;i<60;i++){try{const r=await fetch(base+"/");if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}
  throw new Error(`Server did not start: ${output}`);
}
(async()=>{
  await wait();
  const beforeAuthFailures=fs.readFileSync(dbPath,"utf8");
  let denied=await call(`/api/orders/${cancellable.id}/cancel`,{method:"POST",authToken:"expired-session-token"});
  pass(denied.status===401&&denied.body.code==="AUTHENTICATION_REQUIRED"&&denied.body.message.includes("انتهت جلسة الدخول"),"expired session returns a clear 401 for cancel");
  denied=await call(`/api/orders/${prep.id}/prepare/reopen`,{method:"POST",authToken:"expired-session-token"});
  pass(denied.status===401&&denied.body.code==="AUTHENTICATION_REQUIRED"&&denied.body.message.includes("انتهت جلسة الدخول"),"expired session returns a clear 401 for reopen");
  pass(fs.readFileSync(dbPath,"utf8")===beforeAuthFailures,"401 order actions do not change data");
  const accountantLogin=await call("/api/login",{method:"POST",body:{username:"accountant",password:process.env.DOTCOM_TEST_PASSWORD||"DotCom@2026"},authToken:""});
  pass(accountantLogin.status===200,"restricted user login");
  denied=await call(`/api/orders/${cancellable.id}/cancel`,{method:"POST",authToken:accountantLogin.body.token});
  pass(denied.status===403&&denied.body.code==="PERMISSION_DENIED"&&denied.body.message==="ليس لديك صلاحية لتنفيذ هذا الإجراء","restricted user gets a clear 403 for cancel");
  denied=await call(`/api/orders/${prep.id}/prepare/reopen`,{method:"POST",authToken:accountantLogin.body.token});
  pass(denied.status===403&&denied.body.code==="PERMISSION_DENIED","restricted user gets a clear 403 for reopen");
  pass(fs.readFileSync(dbPath,"utf8")===beforeAuthFailures,"403 order actions do not change data");
  const login=await call("/api/login",{method:"POST",body:{username:"owner",password:process.env.DOTCOM_TEST_PASSWORD||"DotCom@2026"}});token=login.body.token;pass(login.status===200,"owner login");
  const cancelled=await call(`/api/orders/${cancellable.id}/cancel`,{method:"POST",body:{reason:"QA auth action"}});
  pass(cancelled.status===200&&cancelled.body.order.status==="ملغي"&&cancelled.body.order.workflowStage==="cancelled"&&cancelled.body.order.cancelledAt,"owner can cancel an order with terminal workflow state");
  const afterFirstCancel=JSON.parse(fs.readFileSync(dbPath,"utf8")),cancelAuditCount=(afterFirstCancel.audit||[]).filter(row=>row.entityId===cancellable.id&&row.action==="إلغاء الطلب وتحرير الحجز").length;
  const cancelledAgain=await call(`/api/orders/${cancellable.id}/cancel`,{method:"POST",body:{reason:"duplicate click"}});
  const afterSecondCancel=JSON.parse(fs.readFileSync(dbPath,"utf8"));
  pass(cancelledAgain.status===200&&cancelledAgain.body.existing===true&&cancelledAgain.body.order.workflowStage==="cancelled","already-cancelled order returns idempotently");
  pass((afterSecondCancel.audit||[]).filter(row=>row.entityId===cancellable.id&&row.action==="إلغاء الطلب وتحرير الحجز").length===cancelAuditCount,"idempotent cancel creates no duplicate audit");
  const blockedPaidCancel=await call(`/api/orders/${settledCancellable.id}/cancel`,{method:"POST",body:{reason:"must settle first"}});
  pass(blockedPaidCancel.status===409&&blockedPaidCancel.body.code==="PAYMENT_REFUND_REQUIRED","paid order cancellation is blocked before settlement");
  const refund=await call(`/api/orders/${settledCancellable.id}/refunds`,{method:"POST",body:{settlementType:"cash_refund",refundMethod:"cash",amount:670,orderId:settledCancellable.id,invoiceId:"",paymentId:"PAY-WF-12",customerId:settledCancellable.customerId,cashAccountId:refundCashAccount.id,reason:"QA full settlement",operationKey:"WF-REFUND-12"}});
  pass(refund.status===201&&refund.body.preview.canCancel===true,"full refund unlocks paid order cancellation");
  const paidCancelled=await call(`/api/orders/${settledCancellable.id}/cancel`,{method:"POST",body:{reason:"QA cancel after settlement"}});
  pass(paidCancelled.status===200&&paidCancelled.body.order.status==="ملغي"&&paidCancelled.body.order.workflowStage==="cancelled","paid order cancels after full settlement");
  const paidCancelSnapshot=JSON.parse(fs.readFileSync(dbPath,"utf8")),paidCounts={refunds:paidCancelSnapshot.orderRefunds.length,payments:paidCancelSnapshot.orderPayments.length,cash:paidCancelSnapshot.cash.length,audit:paidCancelSnapshot.audit.length};
  const paidCancelledAgain=await call(`/api/orders/${settledCancellable.id}/cancel`,{method:"POST",body:{reason:"duplicate paid cancel"}}),paidRetrySnapshot=JSON.parse(fs.readFileSync(dbPath,"utf8"));
  pass(paidCancelledAgain.body.existing===true&&paidRetrySnapshot.orderRefunds.length===paidCounts.refunds&&paidRetrySnapshot.orderPayments.length===paidCounts.payments&&paidRetrySnapshot.cash.length===paidCounts.cash&&paidRetrySnapshot.audit.length===paidCounts.audit,"paid-order cancel retry creates no refund payment cash movement or audit");
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
