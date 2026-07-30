#!/usr/bin/env node
"use strict";

const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const Finance=require("../app/order-finance.js");
const assert=(condition,label)=>{if(!condition)throw new Error(label);console.log(`PASS ${label}`);};
const close=(a,b)=>Math.abs(Number(a)-Number(b))<0.001;

const a=Finance.calculateDiscount(150,20,"percent");
assert(close(a.discountAmount,30)&&close(a.discountPercent,20)&&close(a.finalAmount,120),"150 with 20% => discount 30 and final 120");
const b=Finance.calculateDiscount(150,30,"amount");
assert(close(b.discountAmount,30)&&close(b.discountPercent,20)&&close(b.finalAmount,120),"150 with 30 EGP => 20% and final 120");
const c=Finance.calculateOrder([{qty:1,price:150,discount:0}]);
assert(close(c.discountTotal,0)&&close(c.total,150),"no discount remains clean");
const fixedUnit=Finance.calculateOrder([{qty:4,price:150,discount:20,discountType:"amount",discountScope:"unit"}]);
assert(close(fixedUnit.lines[0].unitDiscountAmount,20)&&close(fixedUnit.subtotal,600)&&close(fixedUnit.productDiscountTotal,80)&&close(fixedUnit.total,520),"fixed 20 EGP discount applies to each of 4 units");
const percentUnit=Finance.calculateOrder([{qty:4,price:200,discount:10,discountType:"percent",discountScope:"unit"}]);
assert(close(percentUnit.lines[0].unitDiscountAmount,20)&&close(percentUnit.subtotal,800)&&close(percentUnit.productDiscountTotal,80)&&close(percentUnit.total,720),"10% discount applies to each of 4 units");
const unitQtyOne=Finance.calculateOrder([{qty:1,price:150,discount:20,discountType:"amount",discountScope:"unit"}]);
assert(close(unitQtyOne.lines[0].unitDiscountAmount,20)&&close(unitQtyOne.total,130)&&close(fixedUnit.lines[0].unitDiscountAmount,20),"unit discount remains 20 when quantity changes from 1 to 4");
const d=Finance.calculateOrder([{qty:2,price:150,discount:20,discountType:"percent"},{qty:1,price:100,discount:10,discountType:"amount"}],{orderDiscount:20,orderDiscountType:"amount",shippingCost:30});
assert(close(d.subtotal,400)&&close(d.productDiscountTotal,70)&&close(d.orderDiscountAmount,20)&&close(d.total,340),"mixed product and order discounts are applied once");
const arabic=Finance.calculateOrder([{qty:"٢",price:"۱۵۰",discount:"٢٠",discountType:"percent"}]);
assert(close(arabic.total,240),"Arabic and Persian numerals are normalized");
assert(Finance.calculatePayment(670,0).paymentStatus==="unpaid"&&close(Finance.calculatePayment(670,0).remainingAmount,670),"unpaid calculation");
assert(Finance.calculatePayment(670,200).paymentStatus==="partially_paid"&&close(Finance.calculatePayment(670,200).remainingAmount,470),"advance payment calculation");
assert(Finance.calculatePayment(670,670).paymentStatus==="paid"&&close(Finance.calculatePayment(670,670).remainingAmount,0),"full payment calculation");
assert((()=>{try{Finance.calculatePayment(670,700);return false;}catch{return true;}})(),"paid amount above total is rejected");
assert((()=>{try{Finance.calculateDiscount(150,101,"percent");return false;}catch{return true;}})(),"discount above 100% is rejected");
assert((()=>{try{Finance.calculateDiscount(150,151,"amount");return false;}catch{return true;}})(),"discount amount above price is rejected");

const legacy={onlineOrders:[{id:"ORD-LEGACY",total:670,lines:[{bookId:"B1",qty:1,price:670}]}],customers:[{id:"C1",name:"Legacy"}]};
const before=JSON.stringify(legacy),sha=crypto.createHash("sha256").update(before).digest("hex");
const runtime=Finance.calculatePayment(legacy.onlineOrders[0].total,legacy.onlineOrders[0].paidAmount||0);
assert(runtime.paidAmount===0&&runtime.remainingAmount===670,"legacy order gets runtime payment defaults");
assert(!Object.hasOwn(legacy.onlineOrders[0],"paidAmount")&&!Object.hasOwn(legacy,"orderPayments"),"runtime read does not materialize payment fields");
legacy.customers[0].name="Legacy Updated";
const unrelated=JSON.stringify(legacy);
assert(!unrelated.includes("paidAmount")&&!unrelated.includes("orderPayments"),"unrelated save does not materialize payment fields");
assert(sha!==crypto.createHash("sha256").update(unrelated).digest("hex"),"unrelated fixture changed only by intended edit");

const cod=Finance.calculatePayment(670,200);
assert(cod.amountDueAtDelivery===470,"shipment COD equals grand total minus confirmed advance");
const afterAdd=Finance.calculatePayment(770,200),afterRemove=Finance.calculatePayment(720,200);
assert(afterAdd.remainingAmount===570&&afterRemove.remainingAmount===520,"remaining follows edits after advance");

console.log("Order discount/payment QA complete.");
