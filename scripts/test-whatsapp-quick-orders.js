#!/usr/bin/env node
"use strict";

const base=process.env.DOTCOM_BASE_URL||"http://127.0.0.1:8899";
const password=process.env.DOTCOM_TEST_PASSWORD||"DotCom@2026";
const host=new URL(base).hostname;
if(!["127.0.0.1","localhost","::1"].includes(host))throw new Error("This QA test only runs against a loopback server.");

const assert=(condition,message)=>{if(!condition)throw new Error(message);console.log(`PASS ${message}`);};
async function login(username){
  const response=await fetch(`${base}/api/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password})});
  const body=await response.json();if(!response.ok)throw new Error(`login ${username}: ${body.message}`);
  return body.token;
}
async function request(path,{token,method="GET",body}={}){
  const response=await fetch(`${base}${path}`,{method,headers:{"X-Session-Token":token,...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
  return {status:response.status,body:await response.json().catch(()=>({}))};
}

(async()=>{
  const owner=await login("owner"),warehouse=await login("warehouse"),accountant=await login("accountant");
  const initial=(await request("/api/db",{token:owner})).body;
  const books=(initial.books||[]).filter(book=>!book.deletedAt&&Number(book.stock)>=4).slice(0,3);
  assert(books.length===3,"QA has three stocked books");
  const stamp=Date.now();
  const payload={
    phone:`010${String(stamp).slice(-8)}`,customerName:"عميل واتساب QA",governorate:"القاهرة",city:"مدينة نصر",address:"عنوان QA معزول",
    chatwootConversationId:`qa-whatsapp-${stamp}`,shippingCost:35,
    lines:books.slice(0,2).map((book,index)=>({bookId:book.id,qty:index+1,discount:index?10:0,discountType:"percent"}))
  };
  let result=await request("/api/orders/quick",{token:accountant,method:"POST",body:payload});
  assert(result.status===403,"unauthorized role cannot create a quick order");
  result=await request("/api/orders/quick",{token:owner,method:"POST",body:payload});
  assert(result.status===201,"quick-order draft created");
  const orderId=result.body.order.id;
  const duplicate=await request("/api/orders/quick",{token:owner,method:"POST",body:payload});
  assert(duplicate.status===200&&duplicate.body.existing&&duplicate.body.order.id===orderId,"Chatwoot conversation is idempotent");
  const stockBefore=books.map(book=>Number(book.stock));
  const reservedBefore=books.map(book=>Number(book.reservedStock||0));
  const firstConfirm=await request(`/api/orders/${orderId}/confirm`,{token:owner,method:"POST"});
  const secondConfirm=await request(`/api/orders/${orderId}/confirm`,{token:owner,method:"POST"});
  assert(firstConfirm.status===200&&secondConfirm.body.existing,"double confirmation is idempotent");
  const afterConfirm=(await request("/api/db",{token:owner})).body;
  assert(JSON.stringify(stockBefore)===JSON.stringify(books.map(book=>Number(afterConfirm.books.find(item=>item.id===book.id).stock))),"confirmation does not deduct stock before the existing invoice workflow");
  assert(books.slice(0,2).every((book,index)=>Number(afterConfirm.books.find(item=>item.id===book.id).reservedStock||0)===reservedBefore[index]+index+1),"confirmation reserves each requested quantity");
  result=await request(`/api/orders/${orderId}/prepare/start`,{token:accountant,method:"POST"});
  assert(result.status===403,"unauthorized role cannot prepare an order");
  result=await request(`/api/orders/${orderId}/prepare/start`,{token:warehouse,method:"POST"});
  assert(result.status===200,"warehouse started preparation");
  const locked=await request(`/api/orders/${orderId}/prepare/start`,{token:owner,method:"POST"});
  assert(locked.status===409&&locked.body.code==="ORDER_LOCKED","preparation lock prevents a second employee");
  const issue=await request(`/api/orders/${orderId}/prepare/issue`,{token:warehouse,method:"POST",body:{reason:"صنف غير متوفر",notes:"اختبار QA"}});
  assert(issue.status===200&&issue.body.order.workflowStage==="needs_review","preparation issue stops the workflow for review");
  payload.lines.push({bookId:books[2].id,qty:1,discount:0,discountType:"percent"});
  const updated=await request(`/api/orders/${orderId}/quick`,{token:owner,method:"PATCH",body:payload});
  assert(updated.status===200&&updated.body.preparationReset&&updated.body.order.preparationChecklist.length===3,"authorized edit resets the active checklist");
  const afterEdit=(await request("/api/db",{token:owner})).body;
  assert(Number(afterEdit.books.find(item=>item.id===books[2].id).reservedStock||0)===reservedBefore[2]+1,"confirmed-order edit reserves only the added quantity");
  result=await request(`/api/orders/${orderId}/prepare/checklist`,{token:warehouse,method:"PATCH",body:{doneBookIds:payload.lines.map(line=>line.bookId)}});
  assert(result.status===200&&result.body.order.preparationChecklist.every(item=>item.done),"all preparation items checked");
  result=await request(`/api/orders/${orderId}/prepare/complete`,{token:warehouse,method:"POST"});
  assert(result.status===200&&result.body.order.workflowStage==="awaiting_shipping"&&result.body.order.preparedAt,"completed preparation moved directly to ready shipping");
  result=await request(`/api/orders/${orderId}/prepare/start`,{token:warehouse,method:"POST"});
  assert(result.status===409,"ready order cannot start preparation again");
  const finalDb=(await request("/api/db",{token:owner})).body;
  assert(finalDb.audit.filter(item=>item.entityId===orderId).length>=6,"workflow actions recorded in the audit log");
  assert(finalDb.notifications.some(item=>item.entityId===orderId&&item.title.includes("مراجعة")),"customer-service review notification created");
  assert(finalDb.notifications.some(item=>item.entityId===orderId&&item.title.includes("جاهز للشحن")),"shipping notification created");

  const cancelPayload={...payload,phone:`011${String(stamp+1).slice(-8)}`,chatwootConversationId:`qa-cancel-${stamp}`,lines:[{bookId:books[0].id,qty:1}]};
  const cancelDraft=await request("/api/orders/quick",{token:owner,method:"POST",body:cancelPayload});
  await request(`/api/orders/${cancelDraft.body.order.id}/confirm`,{token:owner,method:"POST"});
  const beforeCancel=(await request("/api/db",{token:owner})).body;
  const reservedBeforeCancel=Number(beforeCancel.books.find(item=>item.id===books[0].id).reservedStock||0);
  const cancelled=await request(`/api/orders/${cancelDraft.body.order.id}/cancel`,{token:owner,method:"POST",body:{reason:"QA"}});
  const afterCancel=(await request("/api/db",{token:owner})).body;
  assert(cancelled.status===200&&Number(afterCancel.books.find(item=>item.id===books[0].id).reservedStock||0)===reservedBeforeCancel-1,"cancelling a confirmed order releases its reservation without changing on-hand");

  const concurrencyDb=(await request("/api/db",{token:owner})).body;
  const concurrentBook={...books[0],id:`B-QA-RSV-${stamp}`,name:"كتاب آخر نسخة QA",stock:1,reservedStock:0,barcode:`QA${stamp}`,deletedAt:null};
  concurrencyDb.books.push(concurrentBook);
  assert((await request("/api/db",{token:owner,method:"PUT",body:concurrencyDb})).status===200,"isolated last-copy fixture saved");
  const concurrentPayload=index=>({phone:`012${String(stamp+index).slice(-8)}`,customerName:`عميل تزامن ${index}`,governorate:"القاهرة",address:"QA",chatwootConversationId:`qa-concurrent-${stamp}-${index}`,lines:[{bookId:concurrentBook.id,qty:1}]});
  const drafts=await Promise.all([1,2].map(index=>request("/api/orders/quick",{token:owner,method:"POST",body:concurrentPayload(index)})));
  assert(drafts.every(item=>item.status===201),"two drafts can reference the last copy without reserving it");
  const confirmations=await Promise.all(drafts.map(item=>request(`/api/orders/${item.body.order.id}/confirm`,{token:owner,method:"POST"})));
  assert(confirmations.map(item=>item.status).sort().join(",")==="200,409","concurrent confirmation of the last copy yields one success and one conflict");
  const afterConcurrent=(await request("/api/db",{token:owner})).body;
  assert(Number(afterConcurrent.books.find(item=>item.id===concurrentBook.id).reservedStock||0)===1,"concurrent confirmation leaves exactly one reserved copy");
  const failedIndex=confirmations.findIndex(item=>item.status===409),failedOrder=afterConcurrent.onlineOrders.find(item=>item.id===drafts[failedIndex].body.order.id);
  assert(!failedOrder.confirmedAt&&failedOrder.workflowStage==="draft","failed reservation never enters the preparation queue");

  const siteDb=(await request("/api/db",{token:owner})).body;
  const siteOrderId=`ORD-QA-SITE-${stamp}`;
  siteDb.onlineOrders.push({id:siteOrderId,date:new Date().toISOString().slice(0,10),customerId:siteDb.customers[0]?.id||"",customerName:"عميل موقع QA",phone:"01000000000",governorate:"القاهرة",address:"QA",source:"الموقع",paymentMethod:"الدفع عند الاستلام",status:"طلب جديد",workflowStage:"draft",lines:[{bookId:books[0].id,qty:1,price:Number(books[0].price||0)}],shippingCost:0,total:Number(books[0].price||0),createdAt:new Date().toISOString(),deletedAt:null});
  assert((await request("/api/db",{token:owner,method:"PUT",body:siteDb})).status===200,"legacy website-order fixture saved");
  const siteConfirm=await request(`/api/orders/${siteOrderId}/confirm`,{token:owner,method:"POST"});
  assert(siteConfirm.status===200&&siteConfirm.body.order.inventoryReservation?.status==="active","website order uses the same atomic reservation policy");

  const invoiceDb=(await request("/api/db",{token:owner})).body;
  const invoiceOrder=invoiceDb.onlineOrders.find(item=>item.id===orderId);
  const invoiceId=`INV-QA-RSV-${stamp}`;
  const onHandBeforeInvoice=new Map(invoiceOrder.lines.map(line=>[line.bookId,Number(invoiceDb.books.find(book=>book.id===line.bookId).stock||0)]));
  invoiceDb.sales.push({id:invoiceId,date:new Date().toISOString().slice(0,10),customerId:invoiceOrder.customerId,onlineOrderId:orderId,status:"معتمدة",total:invoiceOrder.total,lines:invoiceOrder.lines.map(line=>({bookId:line.bookId,qty:line.qty,price:line.price}))});
  invoiceOrder.saleId=invoiceId;invoiceOrder.status="تم إنشاء الفاتورة";
  invoiceOrder.lines.forEach(line=>{invoiceDb.books.find(book=>book.id===line.bookId).stock-=Number(line.qty||0);});
  const invoiceWrite=await request("/api/db",{token:owner,method:"PUT",body:invoiceDb});
  assert(invoiceWrite.status===200,"existing invoice write accepted with reservation reconciliation");
  const afterInvoice=(await request("/api/db",{token:owner})).body,consumedOrder=afterInvoice.onlineOrders.find(item=>item.id===orderId);
  assert(consumedOrder.inventoryReservation?.status==="consumed","invoice consumes the active reservation");
  assert(consumedOrder.lines.every(line=>Number(afterInvoice.books.find(book=>book.id===line.bookId).stock)===onHandBeforeInvoice.get(line.bookId)-Number(line.qty||0)),"invoice deducts on-hand exactly once");
  const linkedInvoice=afterInvoice.sales.find(item=>item.id===invoiceId),itemSignature=lines=>lines.map(line=>`${line.bookId}:${Number(line.qty||line.quantity||0)}:${Number(line.price||0)}`).sort().join("|");
  assert(itemSignature(consumedOrder.lines)===itemSignature(linkedInvoice.lines)&&consumedOrder.preparationChecklist.map(item=>`${item.bookId}:${item.qty}`).sort().join("|")===consumedOrder.lines.map(item=>`${item.bookId}:${item.qty}`).sort().join("|"),"order items, preparation checklist, and invoice items share one source of truth");

  const shipmentDb=(await request("/api/db",{token:owner})).body,shipmentOrder=shipmentDb.onlineOrders.find(item=>item.id===orderId),shipmentId=`SH-QA-RSV-${stamp}`,trackingNumber=`QA-RSV-${stamp}`;
  shipmentDb.shipments.unshift({id:shipmentId,shipmentNo:shipmentId,onlineOrderId:orderId,orderId:invoiceId,invoiceId,customerId:shipmentOrder.customerId,customerName:shipmentOrder.customerName,customer:shipmentOrder.customerName,customerPhone:shipmentOrder.phone,phone:shipmentOrder.phone,governorate:shipmentOrder.governorate,city:shipmentOrder.city,address:shipmentOrder.address,company:"البريد المصري",carrier:"البريد المصري",trackingNumber,tracking:trackingNumber,status:"تم التسليم",normalizedStatus:"delivered",shippingStatus:"delivered",productsValue:shipmentOrder.total,customerShippingCharge:0,collectionAmount:shipmentOrder.total,carrierShippingCostExpected:20,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),deletedAt:null});
  shipmentDb.trackingRuns=shipmentDb.trackingRuns||[];shipmentDb.trackingHistory=shipmentDb.trackingHistory||[];
  shipmentDb.trackingRuns.push({id:`TR-QA-${stamp}`,shipmentId,trackingNumber,status:"success",createdAt:new Date().toISOString()});
  shipmentDb.trackingHistory.push({id:`TH-QA-${stamp}`,shipmentId,trackingNumber,normalizedStatus:"delivered",statusText:"تم التسليم",eventAt:new Date().toISOString(),createdAt:new Date().toISOString()});
  Object.assign(shipmentOrder,{shipmentId,tracking:trackingNumber,status:"تم التسليم",updatedAt:new Date().toISOString()});
  assert((await request("/api/db",{token:owner,method:"PUT",body:shipmentDb})).status===200,"shipment and tracking stay linked to the same order and invoice");
  const collectionResult=await request("/api/finance/order-collections",{token:owner,method:"POST",body:{trackingNumber,amount:String(shipmentOrder.total).replace(/\d/g,d=>"٠١٢٣٤٥٦٧٨٩"[Number(d)]),registrationType:"collected_by_carrier"}});
  assert(collectionResult.status===201&&collectionResult.body.collection.onlineOrderId===orderId,"Arabic collection amount creates a linked order collection");
  const collection=collectionResult.body.collection,settlementDb=(await request("/api/db",{token:owner})).body,settlementId=`SET-QA-RSV-${stamp}`;
  const net=Number((Number(collection.amount)-20-Number(collection.expectedCommission||0)).toFixed(2));
  settlementDb.carrierSettlements.push({id:settlementId,company:"البريد المصري",transferDate:new Date().toISOString().slice(0,10),account:"الخزينة الرئيسية",actualNetSettlement:net,otherDeductions:0,status:"مسودة",lines:[{shipmentId,trackingNumber,orderId:invoiceId,invoiceId,onlineOrderId:orderId,collectionAmount:collection.amount,carrierShippingCostExpected:20,collectionCommissionExpected:collection.expectedCommission,expectedNetSettlement:net}]});
  assert((await request("/api/db",{token:owner,method:"PUT",body:settlementDb})).status===200,"linked carrier settlement draft saved");
  const settlementApproval=await request(`/api/finance/settlements/${settlementId}/approve`,{token:owner,method:"POST",body:{}});
  assert(settlementApproval.status===200,"linked carrier settlement approved");
  const financialDb=(await request("/api/db",{token:owner})).body;
  assert(financialDb.expenses.some(item=>item.settlementId===settlementId&&item.orderId===invoiceId),"settlement creates linked expenses");
  assert(financialDb.cash.some(item=>item.settlementId===settlementId&&item.type==="قبض"),"settlement creates the linked cash movement");
  assert(financialDb.onlineOrders.find(item=>item.id===orderId).settlementId===settlementId,"financial journey remains attached to the same orderId");
  console.log(`WhatsApp quick-order QA completed for ${orderId}.`);
})().catch(error=>{console.error(`FAIL ${error.message}`);process.exitCode=1;});
