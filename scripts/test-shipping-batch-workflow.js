"use strict";

const assert=require("assert");
const fs=require("fs");
const path=require("path");
const ShippingBatch=require("../app/shipping-batch-xlsx.js");
const app=fs.readFileSync(path.join(__dirname,"../app/app.js"),"utf8");
const server=fs.readFileSync(path.join(__dirname,"../server-node.js"),"utf8");
const vm=require("vm");
function previewContext(rows){
  const source=app.slice(app.indexOf("function batchShippingPreviewMarkup("),app.indexOf("async function exportShippingCompanyFile("));
  const context=vm.createContext({shippingFileImportRows:rows,shippingImportBusy:false,esc:String,renderOnlineOrders:()=>{}});
  vm.runInContext(source,context);return context;
}
test("ignore and undo affect preview only",()=>{
  const rows=[{ok:false,trackingNumber:"WRONG",message:"unmatched"},{ok:true,orderId:"O1",trackingNumber:"T1"}];
  const context=previewContext(rows);
  vm.runInContext("toggleShippingImportIgnore(0)",context);assert.equal(rows[0].ignored,true);
  assert.match(vm.runInContext("batchShippingPreviewMarkup(shippingFileImportRows)",context),/تراجع عن التجاهل/);
  vm.runInContext("toggleShippingImportIgnore(0)",context);assert.equal(rows[0].ignored,false);
});
test("confirmed shipments and ignored codes leave preview; unresolved errors remain",()=>{
  const context=previewContext([{ok:false,trackingNumber:"BAD"},{ok:true,ignored:true,orderId:"I",trackingNumber:"TI"},{ok:true,orderId:"A",trackingNumber:"TA"},{ok:true,orderId:"B",trackingNumber:"TB"}]);
  context.results=[{ok:true,orderId:"A",trackingNumber:"TA"},{ok:false,orderId:"B",trackingNumber:"TB",message:"failed"}];
  vm.runInContext("applyShippingImportResults(results)",context);
  assert.equal(context.shippingFileImportRows.length,2);assert.equal(context.shippingFileImportRows[1].message,"failed");
  assert.equal(context.shippingFileImportRows[0].trackingNumber,"BAD");
});
test("successful import clears the preview",()=>{
  const context=previewContext([{ok:true,orderId:"A",trackingNumber:"TA"},{ok:false,ignored:true,trackingNumber:"WRONG"},{ok:false,alreadyAdded:true,trackingNumber:"OLD"}]);
  context.results=[{ok:true,orderId:"A",trackingNumber:"TA"}];
  vm.runInContext("applyShippingImportResults(results)",context);
  assert.equal(context.shippingFileImportRows.length,0);
});
test("confirmation excludes ignored rows",()=>{assert.match(app,/shippingFileImportRows\.filter\(row=>row.ok&&!row.ignored\)\.map/);});
test("waiting queue shows only unshipped orders and one confirmation action",()=>{
  const source=app.slice(app.indexOf("function readyShippingOrders("),app.indexOf("function workflowModeTabs("))+app.slice(app.indexOf("function renderReadyShippingQueue("),app.indexOf("function quickShippingOrderCard("));
  const context=vm.createContext({data:{onlineOrders:[{id:"WAIT",workflowStage:"awaiting_shipping",preparedAt:"now",shipmentId:null,saleId:"INV"},{id:"DONE",workflowStage:"shipped",preparedAt:"now",shipmentId:"SH"}]},shippingExportSelection:new Set(),shippingFileImportRows:[{ok:true,orderId:"WAIT",trackingNumber:"T1"}],workflowModeTabs:()=>"",readyShippingRow:order=>`<tr><td>${order.id}</td></tr>`,batchShippingPreviewMarkup:()=>"PREVIEW"});
  vm.runInContext(source,context);
  const before=vm.runInContext("renderReadyShippingQueue()",context);
  assert.match(before,/تأكيد الشحن ونقل 1 طلب إلى قسم الشحن/);assert.match(before,/WAIT/);assert.doesNotMatch(before,/DONE/);
  context.data.onlineOrders[0].workflowStage="shipped";context.data.onlineOrders[0].shipmentId="SH2";context.shippingFileImportRows=[];
  const after=vm.runInContext("renderReadyShippingQueue()",context);
  assert.match(after,/لا توجد طلبات تنتظر كود تتبع/);assert.doesNotMatch(after,/<td>WAIT<\/td>/);
});
test("existing tracking is classified without creating a shipment",()=>{
  const context=vm.createContext({normalizeTrackingNumber:String,ShippingBatchXlsx:ShippingBatch});
  vm.runInContext(server.slice(server.indexOf("function shipmentImportPreview("),server.indexOf("function normalizeCollectionTracking(")),context);
  const result=context.shipmentImportPreview({shipments:[{trackingNumber:"T1"}]},[{trackingNumber:"T1"}]);
  assert.equal(result[0].alreadyAdded,true);assert.equal(result[0].ok,false);
});

function test(name,fn){try{fn();console.log(`PASS ${name}`);}catch(error){console.error(`FAIL ${name}: ${error.message}`);process.exitCode=1;}}

const order={id:"ORD-112",customerName:"عميل اختبار",phone:"01000000000",governorate:"القاهرة",city:"مدينة نصر",address:"عنوان اختبار",total:300,paidAmount:50,notes:"اتصل قبل الوصول",packedWeightGrams:2350,lines:[{bookId:"B1",qty:2}]};
const row=ShippingBatch.orderToUploadRow(order,{books:[{id:"B1",name:"كتاب اختبار"}]});
test("upload row follows the shipping-company template with measured weight",()=>{assert.equal(row.length,16);assert.equal(row[0],"","carrier assigns Package_Serial");assert.match(row[1],/\[ORDER:ORD-112\]/);assert.equal(row[2],2350);assert.equal(row[4],250);assert.ok(row[5].startsWith(ShippingBatch.DELIVERY_NOTE));assert.match(row[5],/اتصل قبل الوصول/);assert.equal(row[7],"01000000000");assert.equal(row[8],"عنوان اختبار - مدينة نصر");assert.equal(row[9],"CAIRO");assert.equal(row[10],"","carrier assigns Package_Ref. Number");});
test("alternative phone is appended to the street",()=>{const withAlt=ShippingBatch.orderToUploadRow({...order,alternativePhone:"٠١١١١١١١١١١"},{books:[]});assert.equal(withAlt[8],"عنوان اختبار - مدينة نصر /رقم اضافي للعميل 01111111111");assert.equal(ShippingBatch.orderToUploadRow({...order,alternativePhone:"01000000000"},{books:[]})[8],"عنوان اختبار - مدينة نصر");});
test("generated workbook is a valid xlsx zip with both required sheets",()=>{const buffer=ShippingBatch.workbookBuffer([row]);assert.equal(buffer.readUInt32LE(0),0x04034b50);assert.ok(buffer.includes(Buffer.from("xl/worksheets/sheet1.xml")));assert.ok(buffer.includes(Buffer.from("xl/worksheets/sheet2.xml")));});
test("real Packages export exposes tracking codes and matching evidence",()=>{const file="/Users/macbook/مكتبه دوت كوم/Packages.xlsx";if(!fs.existsSync(file))return;const rows=ShippingBatch.packageRows(fs.readFileSync(file));assert.equal(rows.length,11);assert.match(rows[0].trackingNumber,/^ENO\d+EG$/);assert.equal(rows[0].phone,"01003977278");assert.equal(rows[0].cod,185);});
test("order reference is extracted from the exported description",()=>{assert.equal(ShippingBatch.extractOrderId("[ORDER:ORD-112]\nكتاب × 1"),"ORD-112");});
test("three-stage UI includes packing, tracking wait and shipped list",()=>{assert.match(app,/<h2>جاهز للتغليف<\/h2>/);assert.match(app,/<h2>مغلف ومنتظر كود تتبع<\/h2>/);assert.match(app,/استيراد الأكواد ومراجعتها/);assert.match(app,/تم تصدير الملف — بانتظار الكود/);});
test("shipment cancellation requires carrier confirmation and resolution",()=>{assert.match(server,/CARRIER_CANCELLATION_CONFIRMATION_REQUIRED/);assert.match(server,/revise_shipment/);assert.match(server,/cancel_order/);assert.match(app,/أؤكد أنني ألغيت الشحنة من نظام شركة الشحن/);});
test("cancelled tracking remains recorded but does not block a replacement shipment",()=>{assert.match(server,/!shipment\.cancelledAt&&shipment\.shippingStatus!=="cancelled"/);assert.match(server,/previousTrackingNumbers/);assert.match(server,/shippingExport:null/);});
test("batch endpoints use authenticated server-side validation",()=>{assert.match(server,/\/api\/orders\/shipping\/export/);assert.match(server,/\/api\/orders\/shipping\/import-preview/);assert.match(server,/TRACKING_ALREADY_USED/);assert.match(server,/PHONE_MISMATCH/);assert.match(server,/COD_MISMATCH/);});
test("order entry chooses Egyptian Post by default and keeps the carrier editable",()=>{
  const source=app.slice(app.indexOf("function activeShippingCompanies("),app.indexOf("function getCustomerFrom("));
  const context=vm.createContext({data:{shippingCompanies:[{name:"بوسطة",active:true},{name:"البريد المصري",active:true}]},esc:String});
  vm.runInContext(source,context);
  assert.equal(context.preferredShippingCompanyName(),"البريد المصري");
  assert.match(context.shippingCompanyOptions(context.preferredShippingCompanyName()),/value="البريد المصري" selected/);
  assert.match(context.shippingCompanyOptions("بوسطة"),/value="بوسطة" selected/);
  assert.match(app,/id="quick-order-shipping-company" required/);
  assert.match(app,/name="shippingCompany" required/);
  assert.match(app,/shippingCompany: formData\.shippingCompany \|\| preferredShippingCompanyName\(\)/);
});
test("shipment confirmation does not ask for a carrier cost or reuse customer shipping fee",()=>{
  const readyModal=app.slice(app.indexOf("function shipReadyOrderModal("),app.indexOf("async function submitReadyOrderShipment("));
  const legacyModal=app.slice(app.indexOf("function shipmentFromOrderModal("),app.indexOf("async function saveSale("));
  assert.doesNotMatch(readyModal,/name:"cost"|تكلفة شركة الشحن المتوقعة/);
  assert.doesNotMatch(legacyModal,/name:"cost"|تكلفة الشحن الإضافية/);
  assert.match(app,/cost: 0, productsValue:/);
  assert.match(server,/customerShippingCharge:Number\(sale\.shipping\|\|order\.shippingCost\|\|0\)/);
});
