'use strict';
// Stock audit 2026-10-30, second part: reserved copies always belong to a live order, a voided sale's copies go back
// into batches even for old sales, and FIFO takes the oldest batch.
const assert = require('node:assert/strict');
const H = require('./integration-test-helpers.js');
const Integrity = require('../app/purchase-inventory-integrity.js');

const book = (db, id) => db.books.find(item => item.id === id);
const order = (db, id) => db.onlineOrders.find(item => item.id === id);
const active = lines => ({ id:`RSV-${Math.random()}`, status:'active', lines, reservedAt:'2026-10-01T00:00:00.000Z' });
const confirmed = (id, lines, extra = {}) => ({ id, customerId:'', customerName:'c', phone:'01000000000', governorate:'القاهرة', status:'قيد التجهيز', workflowStage:'awaiting_preparation', confirmedAt:'2026-10-01T00:00:00.000Z', lines, inventoryReservation:active(lines.map(line => ({ bookId:line.bookId, qty:line.qty }))), ...extra });

async function startupRepair() {
  const db = H.fixtureDb();
  db.books = [{ id:'B1', name:'One', stock:10, reservedStock:7 }, { id:'B2', name:'Two', stock:10, reservedStock:0 }, { id:'B3', name:'Three', stock:4, reservedStock:4 }];
  db.onlineOrders = [
    confirmed('ORD-1', [{ bookId:'B1', qty:2 }]),
    confirmed('ORD-2', [{ bookId:'B2', qty:3 }], { status:'ملغي', workflowStage:'cancelled', cancelledAt:'2026-10-02' }),
    confirmed('ORD-3', [{ bookId:'B3', qty:1 }], { saleId:'INV-9' })
  ];
  const system = await H.startSystem({ db, name:'gaps-repair-' });
  try {
    await H.until(() => book(system.readDb(), 'B1').reservedStock === 2, 'start-up repair');
    const after = system.readDb();
    assert.equal(book(after, 'B2').reservedStock, 0); assert.equal(book(after, 'B3').reservedStock, 0);
    assert.equal(order(after, 'ORD-2').inventoryReservation.status, 'released', 'a cancelled order gives its copies back');
    assert.equal(order(after, 'ORD-3').inventoryReservation.status, 'consumed', 'an invoiced order no longer holds copies');
    assert.ok(after.audit.some(row => row.operationType === 'RESERVED_STOCK_REPAIRED'));
  } finally { system.stop(); }
  console.log('PASS reserved copies are recounted from live orders at start-up');
}

async function deletedAndClosedOrders() {
  const db = H.fixtureDb();
  db.books = [{ id:'B1', name:'One', barcode:'1', stock:10, reservedStock:5 }, { id:'B2', name:'Two', barcode:'2', stock:3, reservedStock:0 }, { id:'B3', name:'Gone', barcode:'3', stock:2, reservedStock:0, deletedAt:'2026-10-02' }];
  db.onlineOrders = [
    confirmed('ORD-C', [{ bookId:'B1', qty:3 }]), confirmed('ORD-D', [{ bookId:'B1', qty:2 }]),
    { id:'ORD-X', customerName:'x', phone:'01000000001', governorate:'القاهرة', status:'ملغي', workflowStage:'cancelled', cancelledAt:'2026-10-02', confirmedAt:'2026-10-01', lines:[{ bookId:'B2', qty:1, price:10 }] },
    { id:'ORD-OLD', status:'حجز مسبق', workflowStage:'awaiting_stock', confirmedAt:'2026-09-01', backorderSince:'2026-09-01', lines:[{ bookId:'B3', qty:1 }], backorderLines:[{ bookId:'B3', qty:1 }] },
    { id:'ORD-NEW', status:'حجز مسبق', workflowStage:'awaiting_stock', confirmedAt:'2026-10-01', backorderSince:'2026-10-01', lines:[{ bookId:'B2', qty:2 }], backorderLines:[{ bookId:'B2', qty:2 }] }
  ];
  const system = await H.startSystem({ db, name:'gaps-orders-' });
  try {
    // The pre-order for a deleted book waits; the next one, whose book is in stock, is not held up by it.
    await H.until(() => order(system.readDb(), 'ORD-NEW').workflowStage === 'awaiting_preparation', 'backorder promotion');
    assert.equal(order(system.readDb(), 'ORD-OLD').workflowStage, 'awaiting_stock');
    const page = await system.api('/api/db');
    order(page.body, 'ORD-C').deletedAt = new Date().toISOString();
    page.body.onlineOrders = page.body.onlineOrders.filter(item => item.id !== 'ORD-D');
    let r = await system.api('/api/db', { method:'PUT', body:page.body, headers:{ 'If-Match':page.headers.get('x-db-revision') } });
    assert.equal(r.status, 200, r.text);
    assert.equal(book(system.readDb(), 'B1').reservedStock, 0, 'deleted and removed orders give their copies back');
    assert.equal(order(system.readDb(), 'ORD-C').inventoryReservation.status, 'released');
    const x = order(system.readDb(), 'ORD-X');
    r = await system.api('/api/orders/ORD-X/quick', { method:'PATCH', body:{ ...x, phone:'01000000001', customerName:'x', address:'x', city:'مدينة نصر', lines:[{ bookId:'B2', qty:1 }] } });
    assert.equal(r.status, 409, r.text); assert.equal(r.body.code, 'ORDER_CLOSED');
    assert.equal(book(system.readDb(), 'B2').reservedStock, 2, 'only ORD-NEW holds B2');
  } finally { system.stop(); }
  console.log('PASS deleted, removed and cancelled orders hold no copies; a deleted book does not block other pre-orders');
}

async function voidOldSaleWithoutBatches() {
  const db = H.fixtureDb();
  db.books = [{ id:'B1', name:'One', stock:3, cost:20 }];
  db.inventoryBatches = [{ id:'BAT-001', batchId:'BAT-001', productId:'B1', remainingQty:3, unitCost:20 }];
  db.sales = [{ id:'INV-1', customerId:'', status:'معتمدة', total:100, paid:0, remaining:0, lines:[{ bookId:'B1', qty:2, price:50 }] }];
  const system = await H.startSystem({ db, name:'gaps-void-old-' });
  try {
    const r = await system.api('/api/sales/INV-1/cancel', { method:'POST', body:{} });
    assert.equal(r.status, 200, r.text);
    const after = system.readDb(), total = after.inventoryBatches.reduce((sum, row) => sum + Number(row.remainingQty || 0), 0);
    assert.equal(book(after, 'B1').stock, 5); assert.equal(total, 5, 'the copies come back into a batch too');
    assert.equal(after.inventoryBatches.find(row => row.source === 'sale_void').unitCost, 20);
  } finally { system.stop(); }
  console.log('PASS voiding an old sale without batch records keeps batches equal to stock');
}

function fifo() {
  const db = { inventoryBatches:[{ id:'BAT-1000', productId:'B1', remainingQty:1, purchaseDate:'2026-10-01', unitCost:2 }, { id:'BAT-999', productId:'B1', remainingQty:1, purchaseDate:'2026-10-01', unitCost:1 }] };
  const result = Integrity.consumeBatchesFIFO(db, 'B1', 1);
  assert.equal(result.allocations[0].batchId, 'BAT-999');
  console.log('PASS FIFO takes BAT-999 before BAT-1000');
}

(async () => {
  await startupRepair();
  await deletedAndClosedOrders();
  await voidOldSaleWithoutBatches();
  fifo();
})().catch(error => { console.error(error); process.exitCode = 1; });
