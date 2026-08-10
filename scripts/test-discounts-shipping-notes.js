#!/usr/bin/env node
"use strict";
const assert=require("assert"),Finance=require("../app/order-finance.js");
const pass=(name,fn)=>{fn();console.log(`PASS ${name}`);};
pass("percent discount updates totals",()=>{const x=Finance.calculateOrder([{qty:2,price:100,discount:10,discountType:"percent"}],{shippingCost:25});assert.equal(x.discountTotal,20);assert.equal(x.goods,180);assert.equal(x.total,205);});
pass("fixed discount updates totals",()=>{const x=Finance.calculateOrder([{qty:1,price:100,discount:30,discountType:"amount"}],{});assert.equal(x.discountTotal,30);assert.equal(x.total,70);});
pass("arabic numbers are supported",()=>assert.equal(Finance.calculateDiscount(200,"٢٥","percent").finalAmount,150));
pass("percent above 100 is blocked",()=>assert.throws(()=>Finance.calculateDiscount(100,101,"percent")));
pass("fixed discount above total is blocked",()=>assert.throws(()=>Finance.calculateDiscount(100,101,"amount")));
pass("negative and non numeric values are blocked",()=>{assert.throws(()=>Finance.calculateDiscount(100,-1,"amount"));assert.throws(()=>Finance.calculateDiscount(100,"abc","amount"));});
pass("shipping is added and free shipping is explicit",()=>{assert.equal(Finance.calculateOrder([{qty:1,price:100}],{shippingCost:20}).total,120);assert.equal(Finance.calculateOrder([{qty:1,price:100}],{shippingCost:0}).shipping,0);});
pass("notes accept long Arabic text safely",()=>assert.equal(Finance.normalizeNote("  ملاحظة عربية طويلة  "),"ملاحظة عربية طويلة"));
pass("oversized notes are blocked",()=>assert.throws(()=>Finance.normalizeNote("x".repeat(5001))));
console.log("9/9 discounts shipping notes tests passed");
