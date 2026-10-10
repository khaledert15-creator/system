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
db.books.push({id:"B-PACK-QA",name:"كتاب تغليف QA",stock:10,reservedStock:2,price:100});
db.inventoryBatches ||= [];
db.inventoryBatches.push({id:"BAT-PACK-QA",productId:"B-PACK-QA",receivedQty:10,remainingQty:10,unitCost:10});
const autoPrep=fixture(20,{stage:"awaiting_preparation",prepared:false,withSale:false});
autoPrep.lines=[{bookId:"B-PACK-QA",qty:2,price:100,discount:10,discountType:"percent"}];
autoPrep.total=250;autoPrep.paidAmount=50;
autoPrep.inventoryReservation={status:"active",lines:[{bookId:"B-PACK-QA",qty:2}]};
db.books.push({id:"B-EDIT-QA",name:"كتاب تعديل QA",stock:20,reservedStock:0,price:100});
db.inventoryBatches.push({id:"BAT-EDIT-QA",productId:"B-EDIT-QA",receivedQty:20,remainingQty:20,unitCost:10});
const editablePacking=fixture(21,{paid:100,stage:"preparing",prepared:false,withSale:false});
editablePacking.preparingByUsername="owner";editablePacking.lines=[{bookId:"B-PACK-QA",qty:1,price:100,discount:0,discountType:"percent"}];
editablePacking.preparationChecklist=[{bookId:"B-PACK-QA",qty:1,done:true}];
const restrictedPacking=fixture(22,{stage:"preparing",prepared:false,withSale:false});
restrictedPacking.preparingByUsername="packing-editor";
restrictedPacking.lines.forEach(line=>{line.discountScope="line";});
db.users.push({...db.users.find(row=>row.username==="owner"),id:"U-PACK-EDIT",username:"packing-editor",role:"كاشير",active:true});
db.settings.permissions ||= {};db.settings.permissions.users ||= {};db.settings.permissions.users["packing-editor"]={actions:["order.quick.edit"]};
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
async function call(route,{method="GET",body,authToken=token,revision}={}){
  const response=await fetch(base+route,{method,headers:{...(authToken?{"X-Session-Token":authToken}:{}),...(revision!==undefined?{"X-DB-Revision":String(revision)}:{}),...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
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
  const editRoute=`/api/orders/${editablePacking.id}/prepare/items`,readPacking=()=>JSON.parse(fs.readFileSync(dbPath,"utf8"));
  const restrictedLogin=await call("/api/login",{method:"POST",body:{username:"packing-editor",password:process.env.DOTCOM_TEST_PASSWORD||"DotCom@2026"}});
  pass(restrictedLogin.status===200,"packing editor without discount/shipping override can log in");
  for(const extra of [{shippingFee:99},{lines:[{...restrictedPacking.lines[0],discount:10,discountType:"percent",discountScope:"unit"}]}]){
    const snapshot=fs.readFileSync(dbPath,"utf8");
    const denied=await call(`/api/orders/${restrictedPacking.id}/prepare/items`,{method:"PATCH",authToken:restrictedLogin.body.token,revision:readPacking().meta?.dataRevision||0,body:{lines:restrictedPacking.lines,...extra}});
    pass(denied.status===403&&fs.readFileSync(dbPath,"utf8")===snapshot,"discount/shipping override permission is enforced without mutation");
  }
  const editLines=[{bookId:"B-PACK-QA",qty:2,price:100},{bookId:"B-EDIT-QA",qty:2,price:60}];
  const beforeEdit=fs.readFileSync(dbPath,"utf8");
  pass((await call(editRoute,{method:"PATCH",body:{lines:editLines},authToken:"expired"})).status===401,"packing edit requires authentication");
  pass((await call(editRoute,{method:"PATCH",body:{lines:editLines},authToken:accountantLogin.body.token})).status===403,"packing edit requires existing order edit permission");
  pass((await call(editRoute,{method:"PATCH",body:{lines:editLines},revision:-1})).status===409,"packing edit rejects stale revision");
  pass(fs.readFileSync(dbPath,"utf8")===beforeEdit,"unauthorized and stale edits leave snapshot unchanged");
  const editedPacking=await call(editRoute,{method:"PATCH",body:{lines:editLines},revision:readPacking().meta?.dataRevision||0});
  pass(editedPacking.status===200&&editedPacking.body.order.lines.length===2&&editedPacking.body.order.total===390,"packing editor adds book and updates quantities, prices and totals");
  pass(editedPacking.body.order.preparationChecklist.every(row=>!row.done),"changed and added items need packing confirmation again");
  const afterEdit=readPacking();
  pass(afterEdit.books.find(row=>row.id==="B-PACK-QA").stock===10&&afterEdit.books.find(row=>row.id==="B-PACK-QA").reservedStock===4&&afterEdit.books.find(row=>row.id==="B-EDIT-QA").price===100,"edit changes reservation but not physical stock or catalog price");
  pass(JSON.stringify(afterEdit.inventoryBatches)===JSON.stringify(JSON.parse(beforeEdit).inventoryBatches)&&JSON.stringify(afterEdit.sales)===JSON.stringify(JSON.parse(beforeEdit).sales)&&JSON.stringify(afterEdit.orderPayments)===JSON.stringify(JSON.parse(beforeEdit).orderPayments),"editing creates no invoice, payment or batch consumption");
  await call(`/api/orders/${editablePacking.id}/prepare/checklist`,{method:"PATCH",body:{doneBookIds:editLines.map(row=>row.bookId)}});
  const changedPrice=await call(editRoute,{method:"PATCH",revision:readPacking().meta.dataRevision,body:{lines:[editLines[0],{...editLines[1],price:70}]}});
  pass(changedPrice.body.order.preparationChecklist[0].done&&!changedPrice.body.order.preparationChecklist[1].done,"only the changed price resets its packing check");
  const deletedLine=await call(editRoute,{method:"PATCH",revision:readPacking().meta.dataRevision,body:{lines:[{...editLines[1],price:70}]}});
  pass(deletedLine.status===200&&deletedLine.body.order.lines.length===1&&readPacking().books.find(row=>row.id==="B-PACK-QA").reservedStock===2,"removing a line releases only that order reservation");
  const customerSnapshot=JSON.stringify(readPacking().customers);
  const priced=await call(editRoute,{method:"PATCH",revision:readPacking().meta.dataRevision,body:{lines:[{bookId:"B-EDIT-QA",qty:2,price:70,discount:10,discountType:"percent",discountScope:"unit"}],shippingFee:90,address:"عنوان توصيل جديد QA"}});
  pass(priced.status===200&&priced.body.order.total===216&&priced.body.order.amountDueAtDelivery===116,"discount and shipping update payable total together");
  pass(priced.body.order.address==="عنوان توصيل جديد QA"&&priced.body.order.shippingFee===90&&priced.body.order.shippingCost===90&&priced.body.order.shippingFeeOverride,"address and canonical shipping aliases are saved");
  pass(JSON.stringify(readPacking().customers)===customerSnapshot,"order address edit does not alter customer master");
  const noteResult=await call(editRoute,{method:"PATCH",revision:readPacking().meta.dataRevision,body:{lines:priced.body.order.lines,notes:"تغليف إضافي\nالاتصال قبل التوصيل"}});
  pass(noteResult.status===200&&noteResult.body.order.notes.includes("الاتصال قبل التوصيل")&&noteResult.body.order.total===216,"notes-only edit persists without changing totals");
  const clearedNote=await call(editRoute,{method:"PATCH",revision:readPacking().meta.dataRevision,body:{lines:noteResult.body.order.lines,notes:""}});
  pass(clearedNote.status===200&&clearedNote.body.order.notes==="","notes can be cleared explicitly");
  for(const extra of [{shippingFee:-1},{address:""},{lines:[{bookId:"B-EDIT-QA",qty:2,price:70,discount:101,discountType:"percent",discountScope:"unit"}]}]){
    const snapshot=fs.readFileSync(dbPath,"utf8");const rejected=await call(editRoute,{method:"PATCH",revision:readPacking().meta.dataRevision,body:{lines:[{bookId:"B-EDIT-QA",qty:2,price:70}],...extra}});
    pass(rejected.status===409&&fs.readFileSync(dbPath,"utf8")===snapshot,"invalid discount, shipping or address never writes data");
  }
  for(const lines of [[],[{bookId:"B-EDIT-QA",qty:0,price:70}],[{bookId:"B-EDIT-QA",qty:99,price:70}],[{bookId:"B-EDIT-QA",qty:1,price:0}],editLines.concat(editLines[0])]){
    const snapshot=fs.readFileSync(dbPath,"utf8");
    pass((await call(editRoute,{method:"PATCH",revision:readPacking().meta.dataRevision,body:{lines}})).status===409&&fs.readFileSync(dbPath,"utf8")===snapshot,"invalid, empty, duplicate, oversold or underpaid edit is blocked atomically");
  }
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
  await call(`/api/orders/${autoPrep.id}/prepare/start`,{method:"POST"});
  const uncheckedSnapshot=fs.readFileSync(dbPath,"utf8");
  pass((await call(`/api/orders/${autoPrep.id}/prepare/complete`,{method:"POST"})).status===409,"unchecked books block packing and invoice");
  pass(fs.readFileSync(dbPath,"utf8")===uncheckedSnapshot,"blocked packing leaves database unchanged");
  await call(`/api/orders/${autoPrep.id}/prepare/checklist`,{method:"PATCH",body:{doneBookIds:["B-PACK-QA"]}});
  const beforePacking=fs.readFileSync(dbPath,"utf8");
  pass((await call(`/api/orders/${autoPrep.id}/prepare/complete`,{method:"POST",authToken:"expired-session-token"})).status===401,"packing requires authenticated session");
  pass((await call(`/api/orders/${autoPrep.id}/prepare/complete`,{method:"POST",authToken:accountantLogin.body.token})).status===403,"packing denies unauthorized users");
  pass((await call(`/api/orders/${autoPrep.id}/prepare/complete`,{method:"POST",revision:-1})).status>=400,"stale packing cannot commit its invoice");
  pass(fs.readFileSync(dbPath,"utf8")===beforePacking,"401, 403 and stale revision preserve all data");
  const autoCompleted=await call(`/api/orders/${autoPrep.id}/prepare/complete`,{method:"POST"});
  pass(autoCompleted.status===200&&autoCompleted.body.order.saleId&&autoCompleted.body.order.workflowStage==="awaiting_shipping","packing atomically creates invoice and moves to waiting tracking");
  const packedDb=JSON.parse(fs.readFileSync(dbPath,"utf8")),invoice=packedDb.sales.find(row=>row.id===autoCompleted.body.order.saleId);
  pass(invoice.total===250&&invoice.paidAmount===50&&invoice.remainingAmount===200,"automatic invoice preserves discounts, shipping and paid amount");
  pass(packedDb.books.find(row=>row.id==="B-PACK-QA").stock===8&&packedDb.books.find(row=>row.id==="B-PACK-QA").reservedStock===0&&packedDb.inventoryBatches.find(row=>row.id==="BAT-PACK-QA").remainingQty===8,"stock, reservation and FIFO batches consumed once");
  pass(!packedDb.shipments.some(row=>row.onlineOrderId===autoPrep.id),"packing never creates a shipment before tracking");
  const packedSnapshot=fs.readFileSync(dbPath,"utf8");
  const invoiceEdit=await call(`/api/orders/${autoPrep.id}/prepare/items`,{method:"PATCH",revision:packedDb.meta.dataRevision,body:{lines:[{bookId:"B-PACK-QA",qty:1,price:100}]}});
  pass(invoiceEdit.status===409&&fs.readFileSync(dbPath,"utf8")===packedSnapshot,"issued invoice blocks packing edits without changing data");
  const retry=await call(`/api/orders/${autoPrep.id}/prepare/complete`,{method:"POST"});
  pass(retry.body.existing===true&&fs.readFileSync(dbPath,"utf8")===packedSnapshot,"packing retry does not duplicate invoice, stock, balance or audit");
  pass((await call(`/api/orders/${prep.id}/prepare/start`,{method:"POST"})).status===409,"prepared order cannot start preparation again");
  const reopened=await call(`/api/orders/${prep.id}/prepare/reopen`,{method:"POST"});
  pass(reopened.status===200&&reopened.body.order.workflowStage==="awaiting_preparation"&&!reopened.body.order.preparedAt,"explicit reopen returns order to preparation");
  const rows=Array.from({length:10},(_,i)=>({orderId:`ORD-WF-${String(i+1).padStart(2,"0")}`,trackingNumber:`WF${String(i+1).padStart(10,"0")}EG`}));
  const beforeBatch=fs.readFileSync(dbPath,"utf8");
  const staleBatch=await call("/api/orders/shipping/batch",{method:"POST",body:{company,rows,previewRevision:-1}});
  pass(staleBatch.status===409&&staleBatch.body.code==="STALE_SHIPPING_PREVIEW"&&fs.readFileSync(dbPath,"utf8")===beforeBatch,"stale shipping preview cannot move orders or create shipments");
  const previewRevision=JSON.parse(beforeBatch).meta.dataRevision;
  const batch=await call("/api/orders/shipping/batch",{method:"POST",body:{company,previewRevision,rows:[...rows,{orderId:"ORD-NOT-READY",trackingNumber:"WF9999999999EG"}]}});
  pass(batch.status===200&&batch.body.results.filter(x=>x.ok).length===10,"10 ready orders shipped in one batch");
  pass(batch.body.results.filter(x=>!x.ok).length===1&&batch.body.results.find(x=>!x.ok).orderId==="ORD-NOT-READY","unmatched code does not create a shipment");
  const after=(await call("/api/db")).body;
  const full=after.shipments.find(x=>x.onlineOrderId==="ORD-WF-01"),partial=after.shipments.find(x=>x.onlineOrderId==="ORD-WF-02");
  pass(full.amountDueAtDelivery===0&&full.collectionAmount===0,"fully paid order COD is zero");
  pass(partial.amountDueAtDelivery===470&&partial.collectionAmount===470,"partially paid order COD equals remaining");
  const duplicate=await call("/api/orders/shipping/batch",{method:"POST",body:{company,rows:[{orderId:"ORD-WF-01",trackingNumber:"WF0000000001EG"},{orderId:"ORD-WF-02",trackingNumber:"WF0000000001EG"}]}});
  pass(duplicate.body.results.every(x=>!x.ok),"already shipped orders and duplicate attempts are rejected");
  pass(after.onlineOrders.filter(x=>/^ORD-WF-0[1-9]$|^ORD-WF-10$/.test(x.id)).every(x=>x.workflowStage==="shipped"&&x.shipmentId),"shipped orders leave ready queue persistently");
  console.log("Fulfillment workflow QA complete.");
})().catch(error=>{console.error(`FAIL ${error.message}`);process.exitCode=1;}).finally(()=>{child.kill("SIGTERM");setTimeout(()=>fs.rmSync(qa,{recursive:true,force:true}),50);});
