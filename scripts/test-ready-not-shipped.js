'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/app.js','utf8');
function fn(name){const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));assert(start>=0,name);return source.slice(start,source.indexOf('\n}',start)+2);}
const c={esc:value=>String(value??''),badge:(text,kind='')=>`<span class="badge ${kind}">${text}</span>`,canAction:()=>true,backorderAllocatable:()=>false};
vm.createContext(c);
vm.runInContext(['onlineOrderWorkflowStage','onlineOrderWorkflowLabel','readyOrderWaitingFor','onlineOrderWorkflowBadge','onlineOrderPrimaryAction'].map(fn).join('\n'),c);
const packed={id:'ORD-1',workflowStage:'awaiting_shipping',preparedAt:'2026-10-19',status:'لم يتم الشحن بعد'};

let html=c.onlineOrderWorkflowBadge({...packed,saleId:'INV-1',packedWeightGrams:900});
assert.match(html,/لم يُشحن بعد/);assert.match(html,/ما زال في المكتبة · ينتظر كود التتبع/);assert.doesNotMatch(html,/تم الشحن/);
assert.match(c.onlineOrderPrimaryAction({...packed,saleId:'INV-1',packedWeightGrams:900}),/data-action="ship-ready-order"[^>]*>إدخال كود التتبع</);
assert.doesNotMatch(c.onlineOrderPrimaryAction({...packed,saleId:'INV-1',packedWeightGrams:900}),/تم الشحن/);
console.log('PASS a packed order says it is still in the store and asks for the tracking code');

assert.match(c.onlineOrderWorkflowBadge({...packed,saleId:'INV-1'}),/ينتظر وزن الطرد/);
assert.match(c.onlineOrderPrimaryAction({...packed,saleId:'INV-1'}),/data-action="packed-weight-edit"[^>]*>تسجيل وزن الطرد</);
assert.match(c.onlineOrderWorkflowBadge(packed),/ينتظر الفاتورة/);
assert.match(c.onlineOrderPrimaryAction(packed),/data-action="convert-order-sale"/);
console.log('PASS the badge names what the packed order is waiting for');

const shipped=c.onlineOrderWorkflowBadge({...packed,saleId:'INV-1',packedWeightGrams:900,shipmentId:'SHP-1',workflowStage:'shipped'});
assert.match(shipped,/🚚 تم الشحن/);assert.doesNotMatch(shipped,/لم يُشحن/);
console.log('PASS only an order with a shipment shows as shipped');
