const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),finance=require('../app/order-finance');
const source=fs.readFileSync('app/app.js','utf8'),start=source.indexOf('function quickOrderMessage('),fn=source.slice(start,source.indexOf('\n}',start)+2);
const lines=[{bookId:'a',qty:2,price:150},{bookId:'b',qty:1,price:180,discount:10,discountType:'amount'}];
let discount=0;
let preorder=false;
const ctx={quickOrderDraft:{},quickOrderCustomer:()=>null,quickOrderAvailableFor:id=>preorder&&id==='a'?0:99,quickOrderHasPreorder:()=>preorder,getBook:id=>({name:id==='a'?'الأضواء عربي 3ث':'الامتحان\nكيمياء 3ث'}),getOnlineOrder:()=>({id:'O1'}),quickOrderTotalsNow:()=>finance.calculateOrder(lines,{shippingCost:50,orderDiscount:discount,orderDiscountType:'amount'}),quickOrderPaymentNow:t=>({paidAmount:100,remainingAmount:t.total-100})};
vm.createContext(ctx);vm.runInContext(fn,ctx);
let msg=ctx.quickOrderMessage();
assert(msg.includes('• 2 * الأضواء عربي 3ث | النسخة 150 ج | الإجمالي 300 ج'));
assert(msg.includes('• الامتحان كيمياء 3ث | 170 بدل 180 ج'));
assert.equal(msg.split('\n').filter(s=>s.startsWith('•')).length,2);
assert(msg.includes('قيمة الكتب: 470 ج | الشحن: 50 ج'));
assert(msg.includes('الإجمالي: 520 ج'));assert(msg.includes('المتبقي: 420 ج'));
discount=20;ctx.quickOrderDraft.savedOrderId='O1';msg=ctx.quickOrderMessage(true);
assert(msg.startsWith('✅ تم تأكيد الطلب · O1'));assert(msg.includes('خصم الطلب: 20 ج'));assert(msg.includes('قيمة الكتب: 450 ج'));assert(msg.includes('الإجمالي: 500 ج'));
console.log('PASS compact item rows, discounted prices, shipping, payment, order discount and confirmation');

assert(!msg.includes('👤') && !msg.includes('📞') && !msg.includes('📍'));
Object.assign(ctx.quickOrderDraft,{customerName:'أحمد\nمحمد',phone:'01000000000',alternativePhone:'01000000000',governorate:'القاهرة',city:'مدينة نصر',address:'شارع 10',addressMark:'بجوار المدرسة'});
msg=ctx.quickOrderMessage();
assert(msg.includes('👤 أحمد محمد | 📞 01000000000\n📍 القاهرة، مدينة نصر، شارع 10 · علامة: بجوار المدرسة'));
assert.equal(msg.split('01000000000').length-1,1);
assert(msg.indexOf('👤')<msg.indexOf('•'));
ctx.quickOrderDraft.alternativePhone='01111111111';assert(ctx.quickOrderMessage(true).includes('📞 01000000000 / 01111111111'));
console.log('PASS compact customer contact, address, landmark, optional fields and duplicate phone handling');

preorder=true;msg=ctx.quickOrderMessage();
assert(msg.includes('الأضواء عربي 3ث (حجز مسبق)'));assert(!msg.includes('كيمياء 3ث (حجز مسبق)'));assert(msg.includes('⏳ الطلب فيه كتب حجز مسبق'));
console.log('PASS pre-order books are marked in the customer message');
