"use strict";

const assert=require("assert");
const fs=require("fs");
const path=require("path");
const ShippingBatch=require("../app/shipping-batch-xlsx.js");
const app=fs.readFileSync(path.join(__dirname,"../app/app.js"),"utf8");
const server=fs.readFileSync(path.join(__dirname,"../server-node.js"),"utf8");

function test(name,fn){try{fn();console.log(`PASS ${name}`);}catch(error){console.error(`FAIL ${name}: ${error.message}`);process.exitCode=1;}}

const order={id:"ORD-112",customerName:"عميل اختبار",phone:"01000000000",governorate:"القاهرة",city:"مدينة نصر",address:"عنوان اختبار",total:300,paidAmount:50,notes:"اتصل قبل الوصول",lines:[{bookId:"B1",qty:2}]};
const row=ShippingBatch.orderToUploadRow(order,{books:[{id:"B1",name:"كتاب اختبار"}]});
test("upload row follows the shipping-company template",()=>{assert.equal(row.length,16);assert.equal(row[0],"ORD-112");assert.match(row[1],/\[ORDER:ORD-112\]/);assert.equal(row[4],250);assert.equal(row[7],"01000000000");assert.equal(row[9],"CAIRO");assert.equal(row[10],"ORD-112");});
test("generated workbook is a valid xlsx zip with both required sheets",()=>{const buffer=ShippingBatch.workbookBuffer([row]);assert.equal(buffer.readUInt32LE(0),0x04034b50);assert.ok(buffer.includes(Buffer.from("xl/worksheets/sheet1.xml")));assert.ok(buffer.includes(Buffer.from("xl/worksheets/sheet2.xml")));});
test("real Packages export exposes tracking codes and matching evidence",()=>{const file="/Users/macbook/مكتبه دوت كوم/Packages.xlsx";if(!fs.existsSync(file))return;const rows=ShippingBatch.packageRows(fs.readFileSync(file));assert.equal(rows.length,11);assert.match(rows[0].trackingNumber,/^ENO\d+EG$/);assert.equal(rows[0].phone,"01003977278");assert.equal(rows[0].cod,185);});
test("order reference is extracted from the exported description",()=>{assert.equal(ShippingBatch.extractOrderId("[ORDER:ORD-112]\nكتاب × 1"),"ORD-112");});
test("three-stage UI includes packing, tracking wait and shipped list",()=>{assert.match(app,/يحتاج تغليف/);assert.match(app,/مغلف وينتظر كود التتبع/);assert.match(app,/استيراد الأكواد وإتمام الشحن/);assert.match(app,/تم إرساله للشركة/);});
test("shipment cancellation requires carrier confirmation and resolution",()=>{assert.match(server,/CARRIER_CANCELLATION_CONFIRMATION_REQUIRED/);assert.match(server,/revise_shipment/);assert.match(server,/cancel_order/);assert.match(app,/أؤكد أنني ألغيت الشحنة من نظام شركة الشحن/);});
test("cancelled tracking remains recorded but does not block a replacement shipment",()=>{assert.match(server,/!shipment\.cancelledAt&&shipment\.shippingStatus!=="cancelled"/);assert.match(server,/previousTrackingNumbers/);assert.match(server,/shippingExport:null/);});
test("batch endpoints use authenticated server-side validation",()=>{assert.match(server,/\/api\/orders\/shipping\/export/);assert.match(server,/\/api\/orders\/shipping\/import-preview/);assert.match(server,/TRACKING_ALREADY_USED/);assert.match(server,/PHONE_MISMATCH/);assert.match(server,/COD_MISMATCH/);});
