#!/usr/bin/env node
"use strict";

const base=process.env.DOTCOM_BASE_URL||"http://127.0.0.1:8918";
if(!["127.0.0.1","localhost","::1"].includes(new URL(base).hostname))throw new Error("Loopback QA only.");
const password=process.env.DOTCOM_TEST_PASSWORD||"DotCom@2026";
const pass=(ok,label)=>{if(!ok)throw new Error(label);console.log(`PASS ${label}`);};
async function call(path,{token,method="GET",body}={}){const r=await fetch(base+path,{method,headers:{...(token?{"X-Session-Token":token}:{}),...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};}

(async()=>{
  const login=await call("/api/login",{method:"POST",body:{username:"owner",password}}),token=login.body.token;
  pass(login.status===200,"owner login");
  const db=(await call("/api/db",{token})).body,book=(db.books||[]).find(item=>!item.deletedAt&&Number(item.stock)>0),account=(db.cashAccounts||[]).find(item=>item.active!==false);
  pass(Boolean(book&&account),"book and cash account fixture available");
  const stamp=Date.now(),payload={phone:`010${String(stamp).slice(-8)}`,customerName:"عميل دفعة QA",governorate:"القاهرة",address:"QA",chatwootConversationId:`payment-${stamp}`,lines:[{bookId:book.id,qty:1,discount:20,discountType:"percent"}],shippingCost:70,paymentPlan:"advance_cod",paymentMethod:"دفع مقدم + الباقي عند الاستلام",paidAmount:100,paymentConfirmed:true,receiptMethod:"كاش",cashAccountId:account.id};
  const created=await call("/api/orders/quick",{token,method:"POST",body:payload});
  pass(created.status===201,"advance-payment order created");
  const order=created.body.order;
  pass(order.paymentStatus==="partially_paid"&&order.paidAmount===100&&order.remainingAmount===order.total-100,"order payment summary persisted");
  const after=(await call("/api/db",{token})).body,payments=(after.orderPayments||[]).filter(item=>item.orderId===order.id),cash=(after.cash||[]).filter(item=>item.orderId===order.id&&item.category==="دفعة طلب");
  pass(payments.length===1&&cash.length===1,"one receipt and one cash movement created");
  const duplicate=await call("/api/orders/quick",{token,method:"POST",body:payload});
  pass(duplicate.status===200&&duplicate.body.order.id===order.id,"conversation retry is idempotent");
  const patched=await call(`/api/orders/${order.id}/quick`,{token,method:"PATCH",body:payload});
  pass(patched.status===200,"same confirmed payment can safely update draft");
  const final=(await call("/api/db",{token})).body;
  pass((final.orderPayments||[]).filter(item=>item.orderId===order.id).length===1&&(final.cash||[]).filter(item=>item.orderId===order.id&&item.category==="دفعة طلب").length===1,"retry never duplicates receipt or cash");
  const cancel=await call(`/api/orders/${order.id}/cancel`,{token,method:"POST",body:{reason:"QA"}});
  pass(cancel.status===409&&cancel.body.code==="PAYMENT_REFUND_REQUIRED","paid order cancellation requires refund workflow");
  console.log(`Quick-order payment API QA complete for ${order.id}.`);
})().catch(error=>{console.error(`FAIL ${error.message}`);process.exitCode=1;});
