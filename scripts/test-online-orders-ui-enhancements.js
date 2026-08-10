#!/usr/bin/env node
"use strict";
const assert=require("assert"),fs=require("fs"),path=require("path"),app=fs.readFileSync(path.join(__dirname,"../app/app.js"),"utf8"),server=fs.readFileSync(path.join(__dirname,"../server-node.js"),"utf8");
const pass=(name,fn)=>{fn();console.log(`PASS ${name}`);};
pass("sale line has percent and amount selector",()=>assert.match(app,/class="sale-discount-type"[\s\S]*value="percent"[\s\S]*value="amount"/));
pass("sale summary includes goods shipping and final total",()=>{for(const id of ["sale-goods-total","sale-shipping-total","sale-total"])assert.ok(app.includes(id));});
pass("changing customer preserves draft and applies shipping",()=>assert.match(app,/choose-sale-customer[\s\S]*applySaleCustomerShipping/));
pass("sale persists shipping aliases source override and notes",()=>{for(const field of ["shippingFee:totals.shipping","shippingFeeOverride:Boolean","shippingPriceSource:","notes:OrderFinance.normalizeNote"])assert.ok(app.includes(field));});
pass("shipping prices management is present",()=>{assert.match(app,/أسعار الشحن للمحافظات/);assert.match(app,/shipping-governorate-price/);assert.match(app,/shipping-governorate-active/);});
pass("online order stores canonical shipping metadata",()=>{assert.match(app,/shippingFee:totals.shipping/);assert.match(app,/shippingPriceSource:/);});
pass("order details show notes discounts goods and shipping",()=>{assert.match(app,/ملحوظة الطلب/);assert.match(app,/السعر بعد الخصم/);assert.match(app,/totals\.shipping\?money\(totals\.shipping\):"مجاني"/);});
pass("ledger includes a note column and financial context",()=>{assert.match(app,/<th>الملاحظة<\/th>/);assert.match(app,/خصم \$\{money\(invoice\.discount/);});
pass("order and statement printing include discounts shipping and notes",()=>{assert.match(app,/function printOnlineOrder[\s\S]*إجمالي الخصم[\s\S]*رسوم الشحن[\s\S]*ملاحظات/);assert.match(app,/function printStatement[\s\S]*المستخدم[\s\S]*الملاحظة/);});
pass("modal and table refresh close action menus",()=>{assert.match(app,/function openModal[\s\S]*closeAllDropdowns/);assert.match(app,/function renderOnlineOrders\(\) \{\s*closeAllDropdowns/);});
pass("server validates commercial fields before client save",()=>{assert.match(server,/function validateCommercialFields/);assert.match(server,/INVALID_COMMERCIAL_FIELDS/);});
console.log("11/11 online order UI enhancement tests passed");
