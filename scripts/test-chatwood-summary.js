'use strict';
// The WhatsApp panel's copied order message shows a discounted book's price before the discount too.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/integrations/chatwood-panel.js','utf8');
const start=source.indexOf('  function summaryText() {'),fn=source.slice(start,source.indexOf('\n  }\n',start)+4);
const amountLine=source.match(/const amount = [^\n]*;/)?.[0]||'const amount = value => Number(Number(value || 0).toFixed(2)).toString();';
const OrderFinance=require('../app/order-finance.js');
const lines=[{bookId:'B079',qty:1,price:290,discount:25,discountType:'amount'},{bookId:'B061',qty:2,price:330,discount:30,discountType:'amount',discountScope:'unit'},{bookId:'B008',qty:1,price:350,discount:0}];
const totals=OrderFinance.calculateOrder(lines,{shippingCost:80});
const ctx={state:{catalog:{byId:new Map([['B079',{name:'كيمياء ثانوية عامة'}],['B061',{name:'التفوق كيميا'}],['B008',{name:'العمالقه انجليزي'}]])},form:{draft:{customerName:'عميل',phone:'010',governorate:'القاهرة',city:'حلوان',address:'شارع'},done:{order:{id:'ORD-0514',confirmedAt:'x',total:totals.total,paidAmount:50},totals}}}};
vm.createContext(ctx);vm.runInContext(`${amountLine}\n${fn}`,ctx);
const text=ctx.summaryText();
assert.match(text,/• كيمياء ثانوية عامة \| 265 بدل 290 ج/);
assert.match(text,/• 2 \* التفوق كيميا \| النسخة 300 بدل 330 ج \| الإجمالي 600 ج/);
assert.match(text,/• العمالقه انجليزي \| 350 ج/);
console.log('PASS the WhatsApp panel message shows the price before and after the discount');
