#!/usr/bin/env node
"use strict";

const base=process.env.DOTCOM_BASE_URL||"http://127.0.0.1:8876";
const password=process.env.DOTCOM_TEST_PASSWORD||"DotCom@2026";
const assert=(condition,message)=>{if(!condition)throw new Error(message);console.log(`PASS ${message}`);};
async function login(username){
  const response=await fetch(`${base}/api/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password})});
  const body=await response.json();if(!response.ok)throw new Error(`login ${username}: ${body.message}`);
  return body.token;
}
async function request(path,{token,method="GET",body}={}){
  const response=await fetch(`${base}${path}`,{method,headers:{...(token?{"X-Session-Token":token}:{}),...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
  return {status:response.status,body:await response.json().catch(()=>({})),revision:response.headers.get("x-db-revision")};
}

(async()=>{
  const owner=await login("owner"),cashier=await login("cashier"),accountant=await login("accountant");
  const initial=await request("/api/db",{token:owner});
  const db=initial.body,stamp=Date.now();
  for(const key of ["customers","sales","shipments","cash","expenses","otherIncome","orderCollections","audit"])if(!Array.isArray(db[key]))db[key]=[];
  db.customers.push({id:`C-QA-${stamp}`,name:"عميل تحصيل QA",phone:"01012345678"});
  const fixtures=[
    ["QA-COL-MATCH","INV-QA-COL-1",1000,50],
    ["QA-COL-LOW","INV-QA-COL-2",1000,0],
    ["QA-COL-HIGH","INV-QA-COL-3",1000,0],
    ["QA-COL-SETTLED","INV-QA-COL-4",2000,50],
    ["QA-COL-ACCOUNTANT","INV-QA-COL-5",600,0],
    ["QA-COL-ZERO","INV-QA-COL-6",0,0],
    ["QA-COL-CONCURRENT","INV-QA-COL-7",750,0]
  ];
  for(const [tracking,invoice,total,cost] of fixtures){
    db.sales.push({id:invoice,total,customerId:`C-QA-${stamp}`,status:"معتمدة",date:"2026-07-28"});
    db.shipments.push({id:`SH-${tracking}`,trackingNumber:tracking,tracking,invoiceId:invoice,orderId:invoice,customerId:`C-QA-${stamp}`,customer:"عميل تحصيل QA",phone:"01012345678",company:"البريد المصري",status:"تم التسليم",normalizedStatus:"delivered",collectionAmount:total,productsValue:total,customerShippingCharge:0,carrierShippingCostExpected:cost,deletedAt:null});
  }
  const seeded=await request("/api/db",{token:owner,method:"PUT",body:db});
  assert(seeded.status===200,"isolated QA fixtures saved");

  const beforeCash=db.cash.length,beforeExpenses=db.expenses.length;
  const match=await request("/api/finance/order-collections",{token:owner,method:"POST",body:{trackingNumber:" qa-col-match ",amount:"١٠٠٠",collectionDate:"2026-07-28",registrationType:"collected_by_carrier"}});
  assert(match.status===201,"Arabic amount and normalized tracking code accepted");
  assert(match.body.collection.expectedCommission===5,"Egypt Post 0.5% minimum commission is 5");
  const afterCarrier=await request("/api/db",{token:owner});
  assert(afterCarrier.body.cash.length===beforeCash,"carrier-only proof creates no cash movement");
  assert(afterCarrier.body.expenses.length===beforeExpenses,"carrier-only proof creates no expense");
  assert(afterCarrier.body.shipments.find(item=>item.trackingNumber==="QA-COL-MATCH").financialCollectionStatus==="collected_by_carrier","shipment marked collected_by_carrier");

  const duplicate=await request("/api/finance/order-collections",{token:owner,method:"POST",body:{trackingNumber:"QA-COL-MATCH",amount:1000}});
  assert(duplicate.status===409&&duplicate.body.previous?.id===match.body.collection.id,"duplicate collection rejected with previous record");

  const lowMissingReason=await request("/api/finance/order-collections",{token:owner,method:"POST",body:{trackingNumber:"QA-COL-LOW",amount:900}});
  assert(lowMissingReason.status===400,"lower amount requires difference reason");
  const low=await request("/api/finance/order-collections",{token:owner,method:"POST",body:{trackingNumber:"QA-COL-LOW",amount:900,differenceReason:"تحصيل جزئي"}});
  assert(low.status===201&&low.body.collection.difference===-100,"lower amount and reason saved");
  const high=await request("/api/finance/order-collections",{token:owner,method:"POST",body:{trackingNumber:"QA-COL-HIGH",amount:1100,differenceReason:"رسوم إضافية"}});
  assert(high.status===201&&high.body.collection.difference===100,"higher amount and reason saved");

  const settled=await request("/api/finance/order-collections",{token:owner,method:"POST",body:{trackingNumber:"QA-COL-SETTLED",amount:2000,registrationType:"settled",account:"الخزينة الرئيسية"}});
  assert(settled.status===201&&settled.body.collection.expectedCommission===10,"2000 collection commission is 10");
  const afterSettled=await request("/api/db",{token:owner});
  assert(afterSettled.body.cash.filter(item=>item.collectionId===settled.body.collection.id&&item.type==="قبض").length===1,"settled collection creates one cash-in");
  assert(afterSettled.body.expenses.filter(item=>item.collectionId===settled.body.collection.id).length===2,"settled collection records commission and available shipping cost");
  assert(afterSettled.body.audit.some(item=>item.entityId===settled.body.collection.id),"collection creates audit log");

  const accountantSettle=await request("/api/finance/order-collections",{token:accountant,method:"POST",body:{trackingNumber:"QA-COL-ACCOUNTANT",amount:600,registrationType:"settled",account:"الخزينة الرئيسية"}});
  assert(accountantSettle.status===403,"accountant cannot settle into cash account");
  const accountantProof=await request("/api/finance/order-collections",{token:accountant,method:"POST",body:{trackingNumber:"QA-COL-ACCOUNTANT",amount:600,registrationType:"collected_by_carrier"}});
  assert(accountantProof.status===201&&accountantProof.body.collection.expectedCommission===5,"accountant can record carrier proof");
  const zero=await request("/api/finance/order-collections",{token:owner,method:"POST",body:{trackingNumber:"QA-COL-ZERO",amount:0,registrationType:"collected_by_carrier"}});
  assert(zero.status===201&&zero.body.collection.expectedCommission===0,"zero collection has zero commission");
  const cashierDenied=await request("/api/finance/order-collections",{token:cashier,method:"POST",body:{trackingNumber:"QA-COL-ZERO",amount:0}});
  assert(cashierDenied.status===403,"cashier direct API request is forbidden");
  const listDenied=await request("/api/finance/order-collections",{token:cashier});
  assert(listDenied.status===403,"cashier cannot list order collections");
  const concurrent=await Promise.all([1,2].map(()=>request("/api/finance/order-collections",{token:owner,method:"POST",body:{trackingNumber:"QA-COL-CONCURRENT",amount:750,registrationType:"collected_by_carrier"}})));
  assert(concurrent.map(item=>item.status).sort().join(",")==="201,409","simultaneous duplicate requests yield one success and one conflict");
  const afterConcurrent=await request("/api/db",{token:owner});
  assert(afterConcurrent.body.orderCollections.filter(item=>item.trackingNumber==="QA-COL-CONCURRENT"&&item.status!=="reversed").length===1,"simultaneous requests persist one collection only");
  const accountantReverse=await request(`/api/finance/order-collections/${match.body.collection.id}/reverse`,{token:accountant,method:"POST",body:{reason:"QA"}});
  assert(accountantReverse.status===403,"accountant cannot reverse a collection");
  const reversed=await request(`/api/finance/order-collections/${match.body.collection.id}/reverse`,{token:owner,method:"POST",body:{reason:"اختبار التصحيح"}});
  assert(reversed.status===200&&reversed.body.collection.status==="reversed","manager-level reversal preserves and marks original record");
  const corrected=await request("/api/finance/order-collections",{token:owner,method:"POST",body:{trackingNumber:"QA-COL-MATCH",amount:1000,registrationType:"collected_by_carrier"}});
  assert(corrected.status===201,"reversed collection can be corrected without deleting history");
  console.log("Order collection integration tests completed.");
})().catch(error=>{console.error(`FAIL ${error.message}`);process.exitCode=1;});
