#!/usr/bin/env node
"use strict";
const assert=require("assert"),Refusals=require("../app/order-refusal.js"),Refunds=require("../app/order-refund.js"),DuplicateOrders=require("../app/duplicate-orders.js");
let serial=0;const actor={username:"owner",name:"مالك النظام",uuid:()=>`00000000-0000-4000-8000-${String(++serial).padStart(12,"0")}`};
const pass=(name,fn)=>{fn();console.log(`PASS ${name}`);};

// Books 400 + shipping 60 = 460; deposit 100 paid in advance, 360 cash on delivery owed by the customer.
function fixture({deposit=100}={}){
  const remaining=460-deposit;
  return{
    customers:[{id:"C1",name:"عميل",balance:remaining}],
    books:[{id:"B1",name:"كتاب",stock:5}],
    inventoryBatches:[{id:"BT1",productId:"B1",remainingQty:5}],
    onlineOrders:[{id:"O1",customerId:"C1",customerName:"عميل",phone:"01000000000",total:460,status:"خرج للتوصيل",saleId:"I1",shipmentId:"S1"}],
    sales:[{id:"I1",onlineOrderId:"O1",customerId:"C1",total:460,shippingFee:60,paid:deposit,remaining,status:"معتمدة",lines:[{bookId:"B1",qty:2,price:200,finalNet:400,batchAllocations:[{batchId:"BT1",qty:2}]}]}],
    shipments:[{id:"S1",onlineOrderId:"O1",trackingNumber:"EG1",status:"خرج للتوصيل"}],
    orderPayments:deposit?[{id:"P1",orderId:"O1",customerId:"C1",amount:deposit,status:"confirmed",confirmed:true,cashAccountId:"CA1",cashAccountName:"الخزنة"}]:[],
    orderRefunds:[],customerCredits:[],cash:[],returns:[],stockMovements:[],
    cashAccounts:[{id:"CA1",name:"الخزنة",active:true}]
  };
}
const refuse=(db,payload)=>Refusals.applyRefusal(db,"O1",{operationKey:`k${++serial}`,...payload},actor);
const ledgerBalance=db=>{const rows=Refunds.customerLedger(db,"C1");return rows.length?rows[rows.length-1].balance:0;};

pass("Preview shows the deposit and the cash-on-delivery amount",()=>{
  const p=Refusals.refusalPreview(fixture(),"O1");
  assert.equal(p.canRefuse,true);assert.equal(p.deposit,100);assert.equal(p.codRemaining,360);assert.equal(p.depositCashAccountId,"CA1");
});

pass("Refund deposit -> cash goes out, customer ends at zero, books back in stock",()=>{
  const db=fixture();refuse(db,{outcome:"refund_deposit",cashAccountId:"CA1"});
  assert.equal(db.customers[0].balance,0);
  assert.equal(db.cash.length,1);assert.equal(db.cash[0].amount,100);assert.equal(db.cash[0].type,"صرف");assert.equal(db.cash[0].category,"مرتجع مبيعات - رفض استلام");
  assert.equal(db.books[0].stock,7);assert.equal(db.inventoryBatches[0].remainingQty,7);
  assert.equal(db.sales[0].status,"مرتجع");assert.equal(db.sales[0].remaining,0);assert.equal(db.sales[0].paid,0);
  assert.equal(db.onlineOrders[0].status,"مرتجع");assert.equal(db.shipments[0].status,"مرتجع");
  assert.equal(db.returns[0].mode,"refusal");assert.equal(db.returns[0].subtotal,460);assert.equal(db.returns[0].paidAmount,100);
  assert.equal(Refunds.cancellationPreview(db,{orderId:"O1"}).outstanding,0);
  assert.equal(ledgerBalance(db),0);
});

pass("Keep deposit -> no cash moves, customer ends at zero, deposit counted as shipping compensation",()=>{
  const db=fixture();refuse(db,{outcome:"keep_deposit"});
  assert.equal(db.customers[0].balance,0);assert.equal(db.cash.length,0);
  assert.equal(db.orderRefunds[0].settlementType,"retained_fee");
  assert.equal(db.sales[0].paid,100);assert.equal(db.returns[0].subtotal,360);
  assert.equal(Refunds.cancellationPreview(db,{orderId:"O1"}).outstanding,0);
  assert.equal(ledgerBalance(db),0);
});

pass("Charge shipping -> customer owes the shipping charge above the deposit, never a credit",()=>{
  const db=fixture();refuse(db,{outcome:"charge_shipping",shippingCharge:130});
  assert.equal(db.customers[0].balance,30);assert.equal(db.sales[0].remaining,30);
  assert.equal(db.returns[0].subtotal,330);assert.equal(db.onlineOrders[0].refusal.extraDue,30);
  assert.equal(ledgerBalance(db),30);
});

pass("Charge shipping not above the deposit is rejected and nothing changes",()=>{
  const db=fixture(),before=JSON.stringify(db);
  assert.throws(()=>refuse(db,{outcome:"charge_shipping",shippingCharge:100}),/لا تزيد عن الديبوزت/);
  assert.equal(JSON.stringify(db),before);
});

pass("Order without deposit -> cash-on-delivery debt removed, customer at zero",()=>{
  const db=fixture({deposit:0});refuse(db,{outcome:"keep_deposit"});
  assert.equal(db.customers[0].balance,0);assert.equal(db.orderRefunds.length,0);
});

pass("Same operation key twice -> applied once",()=>{
  const db=fixture();Refusals.applyRefusal(db,"O1",{outcome:"refund_deposit",cashAccountId:"CA1",operationKey:"same"},actor);
  const second=Refusals.applyRefusal(db,"O1",{outcome:"refund_deposit",cashAccountId:"CA1",operationKey:"same"},actor);
  assert.equal(second.existing,true);assert.equal(db.cash.length,1);assert.equal(db.books[0].stock,7);
});

pass("Refused twice or before shipping or without invoice -> blocked",()=>{
  const db=fixture();refuse(db,{outcome:"keep_deposit"});
  assert.throws(()=>refuse(db,{outcome:"keep_deposit"}),/من قبل/);
  const notShipped=fixture();delete notShipped.onlineOrders[0].shipmentId;notShipped.shipments=[];
  assert.equal(Refusals.refusalPreview(notShipped,"O1").canRefuse,false);
  const noInvoice=fixture();noInvoice.sales=[];delete noInvoice.onlineOrders[0].saleId;
  assert.equal(Refusals.refusalPreview(noInvoice,"O1").canRefuse,false);
});

// What the generic return screen did before: proportional debt reduction and the rest of the deposit as credit.
function legacyReturn(db,settlement){
  const sale=db.sales[0],debt=360*400/460,due=400-debt;
  db.customers[0].balance-=debt;if(settlement!=="cash")db.customers[0].balance-=due;
  sale.status="مرتجع";sale.remaining=360-debt;sale.returnedRemaining=debt;sale.paid=100-due;sale.returnedPaid=due;
  db.returns.push({id:"RET-0001",returnNo:"SR-1001",type:"sales_return",documentId:"I1",sourceDocuments:["I1"],debtReduction:debt,customerDue:due,settlement,paidAmount:settlement==="cash"?due:0,balanceEffect:settlement==="cash"?-debt:-(debt+due)});
}

pass("Repair lists an old refusal that left the customer with credit",()=>{
  const db=fixture();legacyReturn(db,"no-settlement");
  assert.equal(Math.round(db.customers[0].balance),-40);
  const [row]=Refusals.repairCandidates(db);
  assert.equal(row.invoiceId,"I1");assert.equal(row.contribution,-40);assert.equal(row.deposit,100);assert.deepEqual(row.allowedOutcomes,Object.keys(Refusals.OUTCOMES));
});

pass("Repair as kept deposit -> customer back to zero and listed no more",()=>{
  const db=fixture();legacyReturn(db,"no-settlement");
  Refusals.applyRepair(db,"I1",{outcome:"keep_deposit",operationKey:"r1"},actor);
  assert.equal(db.customers[0].balance,0);assert.equal(db.sales[0].remaining,0);assert.equal(db.sales[0].paid,100);
  assert.equal(Refusals.repairCandidates(db).length,0);
});

pass("Repair as shipping charge -> customer owes the difference",()=>{
  const db=fixture();legacyReturn(db,"customer-credit");
  Refusals.applyRepair(db,"I1",{outcome:"charge_shipping",shippingCharge:150,operationKey:"r2"},actor);
  assert.equal(db.customers[0].balance,50);assert.equal(db.sales[0].remaining,50);
});

pass("Repair after a cash refund that really happened -> only refunding the deposit is accepted, the rest goes out",()=>{
  const db=fixture();legacyReturn(db,"cash");
  const [row]=Refusals.repairCandidates(db);
  assert.equal(row.cashRefunded,86.96);assert.equal(row.contribution,46.96);
  assert.throws(()=>Refusals.applyRepair(db,"I1",{outcome:"keep_deposit",operationKey:"r3"},actor),/رد الديبوزت/);
  Refusals.applyRepair(db,"I1",{outcome:"refund_deposit",cashAccountId:"CA1",operationKey:"r4"},actor);
  assert.equal(db.customers[0].balance,0);assert.equal(db.cash.length,1);assert.equal(db.cash[0].amount,13.04);
});

pass("Refusal history matches the same phone or customer, never a name alone",()=>{
  const db=fixture();refuse(db,{outcome:"keep_deposit"});
  db.onlineOrders.push({id:"O2",customerId:"C9",customerName:"عميل",phone:"01111111111",status:"مرتجع",workflowStage:"returned"});
  assert.deepEqual(DuplicateOrders.findRefusalHistory(db.onlineOrders,{phone:"+20 100 000 0000"}).map(o=>o.id),["O1"]);
  assert.deepEqual(DuplicateOrders.findRefusalHistory(db.onlineOrders,{phone:"01222222222",alternativePhone:"01111111111"}).map(o=>o.id),["O2"]);
  assert.deepEqual(DuplicateOrders.findRefusalHistory(db.onlineOrders,{customerId:"C1"}).map(o=>o.id),["O1"]);
  assert.equal(DuplicateOrders.findRefusalHistory(db.onlineOrders,{customerName:"عميل"}).length,0);
});

pass("Repair when the recorded cash refund was never paid -> the payout is reversed and the deposit kept",()=>{
  const db=fixture();legacyReturn(db,"cash");
  db.cash.push({id:"TX-0001",type:"صرف",account:"الخزنة",amount:86.96,category:"مرتجع مبيعات",returnId:"RET-0001"});
  Refusals.applyRepair(db,"I1",{outcome:"keep_deposit",cashNotPaid:true,operationKey:"r5"},actor);
  assert.equal(db.customers[0].balance,0);
  const reversal=db.cash.find(tx=>tx.reversesId==="TX-0001");
  assert.equal(reversal.type,"قبض");assert.equal(reversal.amount,86.96);assert.equal(db.cash[0].reversedBy,reversal.id);
  assert.equal(db.returns[0].paidAmount,0);assert.equal(db.returns[0].cashNotPaid,86.96);
  assert.equal(db.sales[0].paid,100);assert.equal(db.sales[0].remaining,0);
  assert.equal(db.onlineOrders[0].workflowStage,"returned");assert.equal(db.onlineOrders[0].paidAmount,100);assert.equal(db.onlineOrders[0].remainingAmount,0);
});

pass("Refusal updates the order's paid and remaining figures shown in the orders list",()=>{
  const db=fixture();refuse(db,{outcome:"charge_shipping",shippingCharge:130});
  assert.equal(db.onlineOrders[0].paidAmount,100);assert.equal(db.onlineOrders[0].remainingAmount,30);
  const refunded=fixture();refuse(refunded,{outcome:"refund_deposit",cashAccountId:"CA1"});
  assert.equal(refunded.onlineOrders[0].paidAmount,0);assert.equal(refunded.onlineOrders[0].remainingAmount,0);
});

console.log("All order refusal tests passed.");
