#!/usr/bin/env node
"use strict";
const assert=require("assert"),Finance=require("../app/order-finance.js");
const rules={byGovernorate:{القاهرة:"٧٠",الجيزة:80},activeByGovernorate:{القاهرة:true,الجيزة:false},defaultCost:50,freeShippingAbove:1000};
const pass=(name,fn)=>{fn();console.log(`PASS ${name}`);};
pass("configured governorate rate is selected",()=>assert.deepEqual(Finance.resolveShippingRate(rules,"القاهرة",200),{fee:70,source:"governorate:القاهرة",configured:true,active:true}));
pass("disabled governorate uses default",()=>assert.equal(Finance.resolveShippingRate(rules,"الجيزة",200).fee,50));
pass("missing governorate uses default with warning metadata",()=>{const x=Finance.resolveShippingRate(rules,"أسوان",200);assert.equal(x.fee,50);assert.equal(x.configured,false);});
pass("free threshold returns free shipping",()=>assert.equal(Finance.resolveShippingRate(rules,"القاهرة",1000).source,"free_shipping"));
pass("invalid shipping price is blocked",()=>assert.throws(()=>Finance.normalizeShippingRules({byGovernorate:{القاهرة:-1}})));
console.log("5/5 governorate shipping price tests passed");
