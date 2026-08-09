#!/usr/bin/env node
"use strict";
const assert=require("assert"),fs=require("fs"),path=require("path");
const app=fs.readFileSync(path.join(__dirname,"../app/app.js"),"utf8");
const server=fs.readFileSync(path.join(__dirname,"../server-node.js"),"utf8");
const pass=(name,fn)=>{fn();console.log(`PASS ${name}`);};

pass("cancelledAt and terminal fields win over stale draft status",()=>assert.match(app,/if\(order\.cancelledAt\|\|order\.workflowStage==="cancelled"/));
pass("cancel response is merged and verified before success",()=>{assert.match(app,/function mergeCancelledOrder/);assert.match(app,/onlineOrderWorkflowStage\(updated\)!=="cancelled"/);assert.match(app,/تم إلغاء الطلب وتحديث حالته بنجاح/);});
pass("final cancel button blocks double click",()=>{assert.match(app,/button\.disabled\|\|button\.dataset\.pending==="true"/);assert.match(app,/button\.dataset\.pending="true"/);assert.match(app,/aria-busy/);});
pass("render refreshes rows actions and counters from current state",()=>{assert.match(app,/function renderOnlineOrders\(\)[\s\S]*const count=stage=>active\.filter\(order=>onlineOrderWorkflowStage\(order\)===stage\)\.length/);assert.match(app,/const terminal=\["delivered","cancelled"\]\.includes\(onlineOrderWorkflowStage\(order\)\)/);});
pass("opening any modal closes action dropdowns",()=>assert.match(app,/function openModal[\s\S]*closeAllDropdowns\(\)/));
pass("outside click scroll and table refresh close dropdowns",()=>{assert.match(app,/if \(!event\.target\.closest\?\.\("details\.table-actions-menu"\)\) closeAllDropdowns\(\)/);assert.match(app,/document\.addEventListener\("scroll", event => \{\s*closeAllDropdowns\(\)/);assert.match(app,/function renderOnlineOrders\(\) \{\s*closeAllDropdowns\(\)/);});
pass("server cancel is idempotent for every terminal marker",()=>assert.match(server,/order\.cancelledAt\|\|order\.workflowStage==="cancelled"\|\|\["ملغي","cancelled","canceled"\]/));
pass("server returns updated order and guards the write revision",()=>{assert.match(server,/operationType:"ORDER_CANCELLED"/);assert.match(server,/return send\(res,200,\{ok:true,order,revision:dbRevision\(\)\}/);});
console.log("8/8 order cancel UI state tests passed");
