'use strict';
// A pre-order whose book the packer reported missing waits for a stock count even after copies arrive; the manual
// «نقل للتجهيز الآن» refusal must say so (AWAITING_STOCK_COUNT), while a plain shortage keeps NO_STOCK_AVAILABLE.
const assert = require('node:assert/strict');
const H = require('./integration-test-helpers.js');

(async () => {
  let system;
  try {
    const db = H.fixtureDb();
    db.books.find(book => book.id === 'B0001').countHoldQty = 2; // 5 in stock, 2 held for a count → 3 free
    db.customers = [{ id:'C-1', name:'عميل', phone:'01000000001' }];
    const order = (id, extra) => ({ id, date:'2026-10-20', customerId:'C-1', customerName:'عميل', phone:'01000000001', source:'whatsapp', status:'حجز مسبق', workflowStage:'awaiting_stock', lines:[{ bookId:'B0001', qty:1, price:100, lineTotal:100 }], total:135, paidAmount:0, confirmedAt:'2026-10-20T10:00:00.000Z', backorderSince:'2026-10-20T10:00:00.000Z', backorderLines:[{ bookId:'B0001', qty:1 }], createdAt:'2026-10-20T10:00:00.000Z', deletedAt:null, ...extra });
    db.onlineOrders = [
      order('ORD-HOLD', { preparationIssue:{ missingLines:[{ bookId:'B0001', qty:1 }], reportedAt:'2026-10-20T11:00:00.000Z' } }),
      order('ORD-SHORT', { lines:[{ bookId:'B0004', qty:1, price:100, lineTotal:100 }], backorderLines:[{ bookId:'B0004', qty:1 }] }),
    ];
    system = await H.startSystem({ db, name:'count-hold-message-' });
    const allocate = id => system.api(`/api/orders/${id}/backorder/allocate`, { method:'POST', body:{} });

    let r = await allocate('ORD-HOLD');
    assert.equal(r.status, 409, r.text);
    assert.equal(r.body.code, 'AWAITING_STOCK_COUNT');
    assert.match(r.body.message, /بانتظار جرد: كتاب B0001 × 1/);
    assert.match(r.body.message, /الكتب الناقصة والحجوزات/);
    assert.deepEqual(r.body.awaitingCount, ['B0001']);
    assert.equal(system.readDb().onlineOrders.find(row => row.id === 'ORD-HOLD').workflowStage, 'awaiting_stock');
    console.log('PASS a packer-reported book says it waits for a stock count, with where to do it');

    r = await allocate('ORD-SHORT');
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'NO_STOCK_AVAILABLE');
    assert.match(r.body.message, /الناقص: كتاب B0004 × 1/);
    assert.doesNotMatch(r.body.message, /بانتظار جرد/);
    console.log('PASS a real shortage keeps the plain missing message');
    console.log('backorder count-hold message tests passed');
  } catch (error) {
    console.error(`FAIL ${error.stack || error.message}`);
    if (system) console.error(system.output().slice(-1500));
    process.exitCode = 1;
  } finally { system?.stop(); }
})();
