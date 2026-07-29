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
  const firstConfirm=await request(`/api/orders/${orderId}/confirm`,{token:owner,method:"POST"});
  const secondConfirm=await request(`/api/orders/${orderId}/confirm`,{token:owner,method:"POST"});
  assert(firstConfirm.status===200&&secondConfirm.body.existing,"double confirmation is idempotent");
  const afterConfirm=(await request("/api/db",{token:owner})).body;
  assert(JSON.stringify(stockBefore)===JSON.stringify(books.map(book=>Number(afterConfirm.books.find(item=>item.id===book.id).stock))),"confirmation does not deduct stock before the existing invoice workflow");
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
  result=await request(`/api/orders/${orderId}/prepare/checklist`,{token:warehouse,method:"PATCH",body:{doneBookIds:payload.lines.map(line=>line.bookId)}});
  assert(result.status===200&&result.body.order.preparationChecklist.every(item=>item.done),"all preparation items checked");
  result=await request(`/api/orders/${orderId}/prepare/complete`,{token:warehouse,method:"POST"});
  assert(result.status===200&&result.body.order.workflowStage==="awaiting_packing","order moved to packing");
  result=await request(`/api/orders/${orderId}/pack/complete`,{token:warehouse,method:"POST"});
  assert(result.status===200&&result.body.order.workflowStage==="awaiting_shipping","order moved to shipping");
  const finalDb=(await request("/api/db",{token:owner})).body;
  assert(finalDb.audit.filter(item=>item.entityId===orderId).length>=6,"workflow actions recorded in the audit log");
  assert(finalDb.notifications.some(item=>item.entityId===orderId&&item.title.includes("مراجعة")),"customer-service review notification created");
  assert(finalDb.notifications.some(item=>item.entityId===orderId&&item.title.includes("جاهز للشحن")),"shipping notification created");
  console.log(`WhatsApp quick-order QA completed for ${orderId}.`);
})().catch(error=>{console.error(`FAIL ${error.message}`);process.exitCode=1;});
