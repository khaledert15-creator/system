'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/app.js','utf8');
function fn(name){const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));assert(start>=0,name);return source.slice(start,source.indexOf('\n}',start)+2);}
const day=86400000,ago=days=>new Date(Date.now()-days*day).toISOString();
const books=[
 {id:'PHY',name:'الوافي فيزياء 2 باكلوريا',stock:12,reservedStock:2,countHoldQty:10},
 {id:'NEW',name:'نيوتن اسأله 3ث',stock:1,reservedStock:1},
 {id:'OK',name:'كتاب متوفر',stock:20,reservedStock:0,reorder:2},
 {id:'LOW',name:'كشكول',stock:1,reservedStock:0,reorder:3},
];
const preorder=(id,lines,days)=>({id,customerName:`عميل ${id}`,workflowStage:'awaiting_stock',backorderSince:ago(days),lines});
const c={data:{books,onlineOrders:[
 preorder('P1',[{bookId:'PHY',qty:1},{bookId:'OK',qty:1}],3),
 preorder('P2',[{bookId:'PHY',qty:2},{bookId:'NEW',qty:1},{bookId:'NEW',qty:2}],1),
 preorder('P3',[{bookId:'NEW',qty:2}],0),
 {id:'R1',customerName:'محجوز',workflowStage:'awaiting_preparation',inventoryReservation:{status:'active',lines:[{bookId:'PHY',qty:2},{bookId:'NEW',qty:1}]}},
 {id:'R2',workflowStage:'shipped',inventoryReservation:{status:'consumed',lines:[{bookId:'PHY',qty:5}]}},
]}};
c.getBook=id=>books.find(book=>book.id===id);
vm.createContext(c);
vm.runInContext(['bookReservedStock','bookCountHold','bookAvailableStock','backorderOrders','sinceLabel','shortageRows'].map(fn).join('\n'),c);
const plain=value=>JSON.parse(JSON.stringify(value));
const rows=c.shortageRows(),row=id=>rows.find(item=>item.bookId===id);

assert.deepEqual(plain(rows.map(item=>item.bookId)),['NEW','PHY','LOW'],'books that need action, largest shortfall first; a book with enough copies is not listed');
const phy=row('PHY');
assert.equal(phy.reserved,2,'copies already reserved for confirmed orders');
assert.equal(phy.preorder,3,'full quantities of the waiting pre-orders');
assert.equal(phy.needed,5,'total needed = reserved + pre-order');
assert.equal(phy.shortfall,3,'only 2 copies are on the shelf (10 await a count)');
assert.deepEqual(plain(phy.preorderOrders.map(item=>item.order.id)),['P1','P2']);assert.deepEqual(plain(phy.reservedOrders.map(item=>[item.order.id,item.qty])),[['R1',2]],'only active reservations are listed');
console.log('PASS each book shows reserved, pre-order and total needed, and the shortfall the shelf cannot cover');

const nw=row('NEW');
assert.equal(nw.preorder,5,'two lines of the same book in one order are added up');assert.equal(nw.preorderOrders.length,2);
assert.equal(nw.needed,6);assert.equal(nw.shortfall,5);assert.equal(nw.toBuy,5);
assert.equal(c.sinceLabel(nw.oldest),'أمس','oldest pre-order age is shown in words');
console.log('PASS the purchase quantity is the shortfall');

const low=row('LOW');
assert.equal(low.shortfall,0);assert.equal(low.suggested,2,'a low-stock book with no demand suggests topping up to the reorder level');
assert.equal(c.sinceLabel(ago(0)),'اليوم');assert.equal(c.sinceLabel(ago(5)),'منذ 5 أيام');assert.equal(c.sinceLabel(''),'');
console.log('PASS low-stock books keep a reorder suggestion');

const markup=fn('renderShortagesScreen');
for(const label of ['في المخزن','محجوز بالفعل','حجز مسبق','إجمالي المطلوب','الناقص','نسخة ناقصة يجب شراؤها','نسخة محجوزة بالفعل'])assert(markup.includes(label),label);
console.log('PASS the list has the summary, the new columns and a search box');
