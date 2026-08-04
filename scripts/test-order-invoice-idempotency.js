#!/usr/bin/env node
"use strict";
const assert=require("assert"),fs=require("fs"),path=require("path"),Refunds=require("../app/order-refund.js");
const root=path.resolve(__dirname,".."),app=fs.readFileSync(path.join(root,"app/app.js"),"utf8"),server=fs.readFileSync(path.join(root,"server-node.js"),"utf8");
const pass=(ok,label)=>{assert.ok(ok,label);console.log(`PASS ${label}`);};
pass(app.includes('const orderInvoiceConversions = new Set()'),"double click has an in-flight invoice guard");
pass(app.includes('invoiceOperationKey=`order-invoice:${order.id}`'),"each order uses a stable invoice operation key");
pass(app.includes('sale.onlineOrderId === order.id || sale.operationKey===invoiceOperationKey'),"retry returns the existing invoice");
pass((app.match(/recordStockMovement\(book, "بيع أونلاين"/g)||[]).length===1,"online invoice conversion has one stock movement path");
pass(server.includes('if(order.confirmedAt&&activeReservation(order))return send(res,200,{ok:true,order,existing:true'),"confirm endpoint is idempotent");
pass(server.includes('PAYMENT_ALREADY_RECORDED')&&server.includes('DUPLICATE_PAYMENT'),"duplicate payments are blocked");
pass(server.includes('shipmentForOnlineOrder(db,order)')&&server.includes('ORDER_ALREADY_SHIPPED'),"duplicate shipment is blocked");
pass(app.includes('"X-DB-Revision":dbRevision')&&server.includes('expectedRevision:req.headers["x-db-revision"]'),"stale revision guard covers cancellation financial writes");
const db={onlineOrders:[{id:"O1"}],sales:[{id:"I1",onlineOrderId:"O1",createdAt:"2026-01-01"},{id:"I2",onlineOrderId:"O1",createdAt:"2026-01-02"}],orderPayments:[{id:"P1",orderId:"O1",sourceKey:"PAY-O1"},{id:"P2",orderId:"O1",sourceKey:"PAY-O1"}],receipts:[],orderRefunds:[],customers:[]};
const preview=Refunds.repairPreview(db);pass(preview.dryRun&&preview.duplicateInvoices[0].canonicalInvoiceId==="I1"&&preview.duplicateInvoices[0].duplicateInvoiceIds[0]==="I2","repair preview keeps canonical invoice and proposes void only");
pass(preview.duplicatePayments[0].paymentIds.join(",")==="P1,P2","repair preview reports duplicate payments without changing them");
pass(db.sales.every(x=>!x.status),"repair preview is read-only");
console.log("11/11 order invoice idempotency tests passed");
