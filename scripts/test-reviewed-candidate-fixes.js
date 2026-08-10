#!/usr/bin/env node
"use strict";
const assert=require("assert"),fs=require("fs"),path=require("path");
const app=fs.readFileSync(path.join(__dirname,"../app/app.js"),"utf8");
const server=fs.readFileSync(path.join(__dirname,"../server-node.js"),"utf8");
const css=fs.readFileSync(path.join(__dirname,"../app/styles.css"),"utf8");
const Finance=require("../app/order-finance.js");
let passed=0;
function pass(name,fn){fn();passed+=1;console.log(`PASS ${name}`);}

pass("sale save awaits persistence before clearing the draft",()=>{
  const body=app.match(/async function saveSale[\s\S]*?\n}\n\nasync function fetchLatestDatabaseForPurchase/)[0];
  assert.ok(body.indexOf("await saveData")<body.indexOf("resetSaleDraft()"));
  assert.match(body,/if\(!saved\)[\s\S]*restoreClientData\(beforeData\)[\s\S]*draftSale=beforeDraft/);
});
pass("sale failure cannot show the success toast",()=>{
  const body=app.match(/async function saveSale[\s\S]*?\n}\n\nasync function fetchLatestDatabaseForPurchase/)[0];
  assert.ok(body.indexOf("if(!saved)")<body.indexOf("تم اعتماد الفاتورة"));
});
pass("online order save rolls back and keeps the modal on failure",()=>{
  assert.match(app,/form\.id === "online-order-form"[\s\S]*const beforeData=snapshotClientData\(\)[\s\S]*await saveData[\s\S]*if\(!saved\)[\s\S]*restoreClientData\(beforeData\)[\s\S]*return;[\s\S]*closeModal\(\)/);
});
pass("stale revision has an Arabic retry message",()=>assert.match(app,/DATABASE_WRITE_BLOCKED_STALE_REVISION[\s\S]*احتفظنا بالمسودة/));
pass("shipping override permission is declared in UI and server",()=>{
  assert.match(app,/"order\.shipping\.override":\["مالك","مدير"\]/);
  assert.match(server,/SHIPPING_OVERRIDE_FORBIDDEN/);
  assert.match(server,/canOrderAction\([^\n]+"order\.shipping\.override"/);
});
pass("users without permission get readonly shipping controls",()=>{
  assert.match(app,/saleShippingInput\.readOnly=true/);
  assert.match(app,/shippingInput\.readOnly=true/);
});
pass("automatic and free shipping do not require override",()=>{
  const rules={byGovernorate:{القاهرة:50},activeByGovernorate:{القاهرة:true},defaultCost:20,freeShippingAbove:100};
  assert.strictEqual(Finance.resolveShippingRate(rules,"القاهرة",80).fee,50);
  assert.strictEqual(Finance.resolveShippingRate(rules,"القاهرة",100).fee,0);
});
pass("commercial validation does not mutate its input",()=>{
  const source=server.match(/function validateCommercialFields\(db\) \{[\s\S]*?\n}\n\nfunction appendNegativeStockAudit/)[0].replace(/\n\nfunction appendNegativeStockAudit$/,"");
  const validate=new Function("OrderFinance",`${source};return validateCommercialFields;`)(Finance);
  const legacy={settings:{shippingRules:{byGovernorate:{القاهرة:"50"}}},sales:[{id:"S1",lines:[],shipping:"0",note:" قديم "}],onlineOrders:[{id:"O1",lines:[]}]};
  const before=JSON.stringify(legacy);
  assert.deepStrictEqual(validate(legacy),{ok:true});
  assert.strictEqual(JSON.stringify(legacy),before);
});
pass("unrelated validation does not materialize new fields",()=>{
  assert.doesNotMatch(server,/db\.settings\.shippingRules\s*=|row\.(?:notes|shippingFee|shippingCost|shipping)\s*=/);
});
pass("mobile quick sale keeps discount value and type visible",()=>{
  assert.match(css,/\.quick-sale-line \.discount-field \{[^}]*display: grid/);
  assert.doesNotMatch(css,/invoice-line \.discount-field[^\n]*display:\s*none/);
});
pass("shipping fallback prefers shippingFee then shippingCost",()=>{
  const source=app.match(/function orderShippingFee\(order\)\{[^\n]+/)[0];
  const read=new Function("OrderFinance",`${source};return orderShippingFee;`)(Finance);
  assert.strictEqual(read(null),0);
  assert.strictEqual(read(undefined),0);
  assert.strictEqual(read({}),0);
  assert.strictEqual(read({shippingFee:25}),25);
  assert.strictEqual(read({shippingCost:30}),30);
  assert.strictEqual(read({shipping:40}),40);
  assert.strictEqual(read({shippingFee:25,shippingCost:30}),25);
  assert.strictEqual(read({shippingFee:"٢٥٫٥"}),25.5);
  const input={shippingFee:"25",shippingCost:30},before=JSON.stringify(input);read(input);assert.strictEqual(JSON.stringify(input),before);
});
pass("new online order modal uses the null-safe shipping helper without mutation",()=>{
  const modal=app.match(/function onlineOrderModal\(order = null\)[\s\S]*?\n}\n\nfunction getOnlineOrder/)[0];
  assert.match(modal,/value="\$\{orderShippingFee\(order\)\}"/);
  assert.doesNotMatch(modal,/data\.onlineOrders\.push|saveData\(/);
});
console.log(`${passed}/${passed} reviewed candidate fix tests passed`);
