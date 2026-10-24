'use strict';
// «شحن المتوفر وإلغاء الناقص» (POST /api/orders/:id/drop-missing): a pre-order whose customer agreed to receive only
// the books available now loses the missing copies, gets a new total, holds the books it keeps and goes to
// preparation in one shipment with no extra fee. Refused for website orders, without consent, when nothing or
// everything is available, and when the customer already paid more than the new total.
const assert = require('node:assert/strict');
const H = require('./integration-test-helpers.js');

(async () => {
  let system;
  try {
    const db = H.fixtureDb();
    db.books = [
      { id:'B0001', name:'متوفر', price:100, cost:60, stock:10, reservedStock:0, supplierId:'S001' },
      { id:'B0002', name:'نسخة واحدة', price:50, cost:30, stock:1, reservedStock:0, allowPreorder:true, supplierId:'S001' },
      { id:'B0003', name:'غير موجود', price:80, cost:40, stock:0, reservedStock:0, allowPreorder:true, supplierId:'S001' }
    ];
    db.onlineOrders = [{ id:'ORD-0500', date:'2026-10-20', customerId:'C1', customerName:'موقع', phone:'01001110000', source:'website', sourcePlatform:'store', websiteOrderNumber:'MK261020-55555',
      status:'حجز مسبق', workflowStage:'awaiting_stock', confirmedAt:'2026-10-20T10:00:00.000Z', lines:[{ bookId:'B0001', qty:1, price:100 }, { bookId:'B0003', qty:1, price:80 }],
      backorderLines:[{ bookId:'B0003', qty:1 }], subtotal:180, discountTotal:0, total:215, shippingFee:35, paidAmount:0, remainingAmount:215, createdAt:'2026-10-20T10:00:00.000Z', deletedAt:null }];
    system = await H.startSystem({ db, name:'drop-missing-' });
    const orderById = id => system.readDb().onlineOrders.find(row => row.id === id);
    const book = id => system.readDb().books.find(row => row.id === id);
    const drop = (id, body = {}, username = 'cashier') => system.api(`/api/orders/${id}/drop-missing`, { username, method:'POST', body:{ customerConsent:true, consentChannel:'واتساب', operationKey:`k-${id}-${Math.random()}`, ...body } });
    const quick = async (requestId, lines, payment = {}) => {
      let r = await system.api('/api/orders/quick', { username:'cashier', method:'POST', body:{ requestId, phone:'01009998887', customerName:'سارة', governorate:'القاهرة', city:'مدينة نصر', address:'شارع 2', shippingCost:0, lines, ...payment } });
      assert.equal(r.status, 201, r.text);
      const id = r.body.order.id;
      r = await system.api(`/api/orders/${id}/confirm`, { username:'cashier', method:'POST', body:{} });
      assert.equal(r.status, 200, r.text);
      return id;
    };

    // B0001×2 available, B0002 has 1 of 2, B0003 none: the customer takes B0001×2 + B0002×1.
    const id = await quick('drop-1', [{ bookId:'B0001', qty:2 }, { bookId:'B0002', qty:2 }, { bookId:'B0003', qty:1 }], { paymentPlan:'advance_cod', paidAmount:100, paymentConfirmed:true, cashAccountId:'CA-003', receiptMethod:'InstaPay' });
    let o = orderById(id);
    assert.equal(o.workflowStage, 'awaiting_stock'); assert.equal(o.total, 200 + 100 + 80);
    assert.equal(book('B0001').reservedStock, 0, 'a pre-order holds no copies');

    let r = await drop(id, {}, 'warehouse');
    assert.equal(r.status, 403);
    r = await drop(id, { customerConsent:false });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'DROP_CONSENT_REQUIRED');
    assert.equal(orderById(id).workflowStage, 'awaiting_stock', 'refusals write nothing');
    console.log('PASS refused without permission (warehouse) or without the customer\'s consent');

    const operationKey = 'drop-once';
    r = await drop(id, { operationKey, consentNote:'وافق على واتساب' });
    assert.equal(r.status, 200, r.text);
    o = orderById(id);
    assert.equal(o.workflowStage, 'awaiting_preparation'); assert.equal(o.status, 'قيد التجهيز');
    assert.deepEqual(o.lines.map(line => [line.bookId, line.qty]), [['B0001', 2], ['B0002', 1]]);
    assert.equal(o.total, 200 + 50, 'new total: kept books + the original shipping (0 here), no extra fee');
    assert.deepEqual([o.paidAmount, o.remainingAmount, o.amountDueAtDelivery], [100, 150, 150]);
    assert.deepEqual(o.backorderLines, []);
    assert.equal(o.inventoryReservation.status, 'active');
    assert.deepEqual([book('B0001').reservedStock, book('B0002').reservedStock, book('B0003').reservedStock], [2, 1, 0]);
    assert.equal(o.droppedLines.length, 1);
    assert.deepEqual(o.droppedLines[0].lines.map(line => [line.bookId, line.qty]), [['B0002', 1], ['B0003', 1]]);
    assert.deepEqual([o.droppedLines[0].totalBefore, o.droppedLines[0].totalAfter, o.droppedLines[0].username, o.droppedLines[0].consent.note], [380, 250, 'cashier', 'وافق على واتساب']);
    assert.ok(system.readDb().audit.some(row => row.entityId === id && row.action === 'شحن المتوفر وإلغاء الناقص'));
    assert.equal(system.readDb().onlineOrders.length, 2, 'no second order is created (the website order + this one)');
    console.log('PASS drops the missing copies (partial line too), new total, keeps the payment, reserves the kept books, goes to preparation');

    r = await system.api(`/api/orders/${id}/drop-missing`, { username:'cashier', method:'POST', body:{ customerConsent:true, operationKey } });
    assert.equal(r.status, 200); assert.equal(r.body.existing, true);
    assert.equal(orderById(id).droppedLines.length, 1, 'a repeated click does nothing more');
    r = await drop(id);
    assert.equal(r.status, 409); assert.equal(r.body.code, 'ORDER_NOT_DROPPABLE', 'it is no longer a pre-order');
    console.log('PASS idempotent; only for pre-orders');

    // Nothing available / everything available / paid more than the new total / website order.
    const none = await quick('drop-2', [{ bookId:'B0003', qty:1 }]);
    r = await drop(none); assert.equal(r.status, 409); assert.equal(r.body.code, 'NOTHING_AVAILABLE_NOW');
    const overpaid = await quick('drop-3', [{ bookId:'B0001', qty:1 }, { bookId:'B0003', qty:2 }], { paymentPlan:'advance_cod', paidAmount:200, paymentConfirmed:true, cashAccountId:'CA-003', receiptMethod:'InstaPay' });
    r = await drop(overpaid); assert.equal(r.status, 409); assert.equal(r.body.code, 'PAID_EXCEEDS_NEW_TOTAL');
    assert.equal(orderById(overpaid).workflowStage, 'awaiting_stock');
    r = await drop('ORD-0500', {}, 'owner'); assert.equal(r.status, 409); assert.equal(r.body.code, 'WEBSITE_ORDER_DROP_UNAVAILABLE');
    r = await system.api(`/api/orders/${overpaid}/split-shipment`, { username:'cashier' });
    assert.equal(r.status, 200); assert.deepEqual([r.body.canDrop, r.body.canSplit], [true, false], 'a cashier gets the drop choice, not the split');
    r = await system.api('/api/orders/ORD-0500/split-shipment', { username:'owner' });
    assert.deepEqual([r.body.canDrop, r.body.canSplit, r.body.websiteLinked], [false, true, true]);
    console.log('PASS refused when nothing is available, when paid exceeds the new total, and for website orders; preview reports the choices');

    console.log('ALL PASS drop missing');
  } catch (error) {
    console.error(error);
    if (system) console.error(system.output().slice(-3000));
    process.exitCode = 1;
  } finally {
    system?.stop();
  }
})();
