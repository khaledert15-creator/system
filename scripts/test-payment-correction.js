'use strict';
// Payment correction (app/payment-correction.js, POST /api/payments/:id/correction): wrong amount, wrong cash
// account/method, the wrong order, money that never arrived; the original payment and cash row are reversed and kept,
// orders/invoice/customer balance/shipment follow, history and audit record who/why, and closed cases are refused.
const assert = require('node:assert/strict');
const H = require('./integration-test-helpers.js');

const NOW = '2026-10-19T10:00:00.000Z';
const order = (id, extra = {}) => ({ id, date:'2026-10-19', customerId:'C0001', customerName:'أحمد', phone:'01001234567', governorate:'القاهرة', city:'', address:'شارع 1', source:'whatsapp',
  status:'قيد التجهيز', workflowStage:'awaiting_preparation', lines:[{ bookId:'B0001', qty:3, price:100, discount:0, discountType:'percent' }], subtotal:300, discountTotal:0, total:300,
  paymentPlan:'cash_on_delivery', paymentMethod:'الدفع عند الاستلام', paidAmount:0, remainingAmount:300, remaining:300, amountDueAtDelivery:300, paymentStatus:'unpaid',
  createdAt:NOW, updatedAt:NOW, deletedAt:null, ...extra });
const payment = (id, orderId, amount, extra = {}) => ({ id, sourceKey:`quick-order-payment:${orderId}:advance`, idempotencyKey:`quick-order-payment:${orderId}:advance`, orderId, invoiceId:'', customerId:'C0001',
  amount, paymentMethod:'InstaPay', cashAccountId:'CA-003', cashAccountName:'InstaPay', confirmed:true, status:'confirmed', receivedBy:'cashier', receivedByUsername:'cashier', receivedAt:NOW, source:'quick_order', ...extra });
const cash = (id, paymentId, orderId, amount, extra = {}) => ({ id, date:'2026-10-19', type:'قبض', direction:'in', locked:true, account:'InstaPay', party:'أحمد', amount, category:'دفعة طلب', orderId, paymentId, sourceKey:`${paymentId}:cash`, note:'', createdAt:NOW, ...extra });
const paidOrder = (id, paid, extra = {}) => order(id, { paymentPlan:'advance_cod', paymentMethod:'مقدم + الباقي عند الاستلام', paidAmount:paid, remainingAmount:300 - paid, remaining:300 - paid, amountDueAtDelivery:300 - paid, paymentStatus:'partially_paid', ...extra });

function fixture() {
  return H.fixtureDb({
    customers:[{ id:'C0001', name:'أحمد', phone:'01001234567', balance:300 }, { id:'C0002', name:'منى', phone:'01007654321', balance:0 }],
    onlineOrders:[
      paidOrder('ORD-0001', 50, { websiteOrderNumber:'MK261019-11111', sourcePlatform:'store', depositRequired:100, deposit:{ required:100, amount:50 }, depositAmount:50, paymentReceiptId:'PAY-A' }),
      order('ORD-0002', { total:200, remainingAmount:200, remaining:200, amountDueAtDelivery:200 }),
      order('ORD-0003', { customerId:'C0002', customerName:'منى', total:150, remainingAmount:150, remaining:150, amountDueAtDelivery:150 }),
      paidOrder('ORD-0004', 30, { status:'ملغي', workflowStage:'cancelled' }),
      paidOrder('ORD-0005', 100, { total:400, remainingAmount:300, remaining:300, amountDueAtDelivery:300, saleId:'INV-0001', shipmentId:'SH-0001', status:'تم الشحن', workflowStage:'shipped' }),
      paidOrder('ORD-0006', 20),
      paidOrder('ORD-0007', 40, { shipmentId:'SH-0007', status:'تم الشحن', workflowStage:'shipped' })
    ],
    orderPayments:[payment('PAY-A', 'ORD-0001', 50, { source:'website_deposit', websiteOrderNumber:'MK261019-11111', senderPhone:'01220000000', transferReference:'IP-123' }),
      payment('PAY-D', 'ORD-0004', 30), payment('PAY-E', 'ORD-0005', 100, { invoiceId:'INV-0001', paymentMethod:'كاش', cashAccountId:'CA-001', cashAccountName:'الخزينة الرئيسية' }),
      payment('PAY-F', 'ORD-0006', 20, { receivedAt:'2026-10-10T09:00:00.000Z' }), payment('PAY-G', 'ORD-0007', 40)],
    cash:[cash('TX-0001', 'PAY-A', 'ORD-0001', 50), cash('TX-0002', 'PAY-E', 'ORD-0005', 100, { account:'الخزينة الرئيسية' }), cash('TX-0003', 'PAY-F', 'ORD-0006', 20, { date:'2026-10-10' }), cash('TX-0004', 'PAY-G', 'ORD-0007', 40)],
    sales:[{ id:'INV-0001', onlineOrderId:'ORD-0005', customerId:'C0001', status:'معتمدة', total:400, paid:100, paidAmount:100, remaining:300, remainingAmount:300, paymentStatus:'partially_paid', lines:[], createdAt:NOW, deletedAt:null }],
    shipments:[{ id:'SH-0001', onlineOrderId:'ORD-0005', invoiceId:'INV-0001', collectionAmount:300, amountDueAtDelivery:300, status:'في الطريق' }, { id:'SH-0007', onlineOrderId:'ORD-0007', collectionAmount:260 }],
    orderCollections:[{ id:'COL-0001', shipmentId:'SH-0007', onlineOrderId:'ORD-0007', amount:260, status:'registered' }],
    dayClosings:[{ id:'DAY-0001', date:'2026-10-10' }]
  });
}

let keySeq = 0;
const key = () => `pc-test-${++keySeq}`;

(async () => {
  let system, store;
  try {
    store = await H.startMockStore();
    system = await H.startSystem({ db:fixture(), env:H.integrationEnv(store), name:'payment-correction-' });
    const correct = (id, body, username = 'cashier') => system.api(`/api/payments/${id}/correction`, { username, method:'POST', body:{ operationKey:key(), ...body } });
    const preview = (id, username = 'cashier') => system.api(`/api/payments/${id}/correction`, { username });
    const db = () => system.readDb();
    const find = (rows, id) => rows.find(row => row.id === id);

    // ---- Who may correct.
    assert.equal((await preview('PAY-A', 'warehouse')).status, 403);
    assert.equal((await correct('PAY-A', { amount:100, reason:'غلط' }, 'accountant')).status, 403);
    assert.equal((await system.api('/api/payments/PAY-A/correction', { token:'' })).status, 401);
    let r = await preview('PAY-A');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.body.payment.amount, r.body.maxAmount, r.body.blocked, r.body.hasCashRow], [50, 300, null, true]);
    console.log('PASS permission: an ordinary employee (cashier) can correct; warehouse/accountant cannot; preview shows the limits');

    // ---- Validation.
    r = await correct('PAY-A', { amount:100, reason:'' });
    assert.equal(r.status, 400); assert.equal(r.body.code, 'REASON_REQUIRED');
    r = await correct('PAY-A', { amount:50, cashAccountId:'CA-003', paymentMethod:'InstaPay', reason:'لا شيء' });
    assert.equal(r.status, 400); assert.equal(r.body.code, 'NOTHING_CHANGED');
    r = await correct('PAY-A', { amount:301, reason:'أكبر من الإجمالي' });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'PAID_EXCEEDS_TOTAL');
    r = await correct('PAY-A', { amount:0, reason:'صفر' });
    assert.equal(r.status, 400); assert.equal(r.body.code, 'AMOUNT_INVALID');
    assert.equal(find(db().orderPayments, 'PAY-A').status, 'confirmed', 'nothing written by refused corrections');
    console.log('PASS validation: reason required, a no-op is refused, paid cannot exceed the total, zero must use «never arrived»');

    // ---- Wrong amount: 50 recorded, customer paid 100 (the reported case, on a website order).
    const operationKey = key();
    r = await system.api('/api/payments/PAY-A/correction', { username:'cashier', method:'POST', body:{ operationKey, amount:'١٠٠', reason:'العميل دفع 100 واتكتب 50' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.correction.kind, 'edit');
    let d = db();
    const old = find(d.orderPayments, 'PAY-A'), fresh = find(d.orderPayments, r.body.correction.newPaymentId);
    assert.equal(old.status, 'reversed'); assert.ok(old.deletedAt); assert.equal(old.amount, 50, 'original kept as it was');
    assert.deepEqual([fresh.amount, fresh.orderId, fresh.correctionOf, fresh.cashAccountId, fresh.transferReference, fresh.receivedAt], [100, 'ORD-0001', 'PAY-A', 'CA-003', 'IP-123', NOW]);
    assert.ok(find(d.cash, 'TX-0001').deletedAt, 'original cash row reversed');
    const newCash = d.cash.filter(row => row.paymentId === fresh.id && !row.deletedAt);
    assert.equal(newCash.length, 1); assert.deepEqual([newCash[0].amount, newCash[0].date, newCash[0].account], [100, '2026-10-19', 'InstaPay']);
    let o1 = find(d.onlineOrders, 'ORD-0001');
    assert.deepEqual([o1.paidAmount, o1.remainingAmount, o1.amountDueAtDelivery, o1.depositAmount, o1.deposit.amount, o1.paymentReceiptId], [100, 200, 200, 100, 100, fresh.id]);
    assert.equal(o1.paymentCorrections.length, 1);
    assert.deepEqual([o1.paymentCorrections[0].before.amount, o1.paymentCorrections[0].after.amount, o1.paymentCorrections[0].username, o1.paymentCorrections[0].reason], [50, 100, 'cashier', 'العميل دفع 100 واتكتب 50']);
    assert.ok(d.audit.some(row => row.operationType === 'ORDER_PAYMENT_CORRECTED' && row.entityId === 'ORD-0001' && row.before.amount === 50 && row.after.amount === 100));
    const links = await (await H.signedFetch(system.base, '/api/integration/v1/website-orders/links')).json();
    const link = links.links.find(row => row.salesOrderId === 'ORD-0001');
    assert.deepEqual([link.depositAmount, link.paidAmount, link.remainingAmount], [100, 100, 200], 'the Store sees the corrected deposit');
    console.log('PASS wrong amount 50→100: original payment and cash row kept as reversed, new ones at the original date, order/deposit/Store link updated, history and audit');

    // ---- The same request again does nothing more; the reversed payment cannot be corrected again.
    const counts = [d.orderPayments.length, d.cash.length];
    r = await system.api('/api/payments/PAY-A/correction', { username:'cashier', method:'POST', body:{ operationKey, amount:100, reason:'العميل دفع 100 واتكتب 50' } });
    assert.equal(r.status, 200); assert.equal(r.body.existing, true);
    assert.deepEqual([db().orderPayments.length, db().cash.length], counts, 'no duplicate');
    r = await correct('PAY-A', { amount:80, reason:'تاني' });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'PAYMENT_ALREADY_CORRECTED');
    console.log('PASS idempotent: a repeated click returns the same correction; a corrected payment is closed');

    // ---- Wrong cash account / method only.
    const current = fresh.id;
    r = await correct(current, { amount:100, cashAccountId:'CA-001', paymentMethod:'كاش', reason:'اتسلّم كاش مش InstaPay' });
    assert.equal(r.status, 200, r.text);
    d = db();
    const third = find(d.orderPayments, r.body.correction.newPaymentId);
    assert.deepEqual([third.amount, third.cashAccountName, third.paymentMethod], [100, 'الخزينة الرئيسية', 'كاش']);
    assert.equal(d.cash.find(row => row.paymentId === third.id && !row.deletedAt).account, 'الخزينة الرئيسية');
    assert.equal(find(d.onlineOrders, 'ORD-0001').paidAmount, 100, 'amount unchanged');
    const accountBalance = name => d.cash.filter(row => !row.deletedAt && row.account === name).reduce((sum, row) => sum + (row.direction === 'out' ? -row.amount : row.amount), 0);
    assert.deepEqual([accountBalance('InstaPay'), accountBalance('الخزينة الرئيسية')], [60, 200], 'InstaPay keeps only its other rows (20+40), main cash box gained the 100');
    console.log('PASS wrong account/method: money moves to the right cash account; the order amount stays');

    // ---- Wrong order: move the 100 to ORD-0002 (same customer), then to ORD-0003 (another customer needs confirmation).
    r = await correct(third.id, { amount:100, targetOrderId:'ord-0003', reason:'اتسجّل على طلب غلط' });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'OTHER_CUSTOMER_CONFIRM_REQUIRED');
    r = await correct(third.id, { amount:100, targetOrderId:'ORD-9999', reason:'اتسجّل على طلب غلط' });
    assert.equal(r.status, 404);
    r = await correct(third.id, { amount:100, targetOrderId:'ORD-0004', reason:'اتسجّل على طلب غلط' });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'TARGET_ORDER_CANCELLED');
    r = await correct(third.id, { amount:100, targetOrderId:'ORD-0002', reason:'اتسجّل على طلب غلط' });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.correction.kind, 'move');
    d = db();
    o1 = find(d.onlineOrders, 'ORD-0001');
    const o2 = find(d.onlineOrders, 'ORD-0002');
    assert.deepEqual([o1.paidAmount, o1.remainingAmount, o1.paymentPlan, o1.depositAmount, o1.paymentReceiptId], [0, 300, 'cash_on_delivery', 0, '']);
    assert.deepEqual([o2.paidAmount, o2.remainingAmount, o2.paymentPlan, o2.paymentStatus], [100, 100, 'advance_cod', 'partially_paid']);
    const moved = find(d.orderPayments, r.body.correction.newPaymentId);
    assert.deepEqual([moved.orderId, moved.websiteOrderNumber, o2.paymentReceiptId], ['ORD-0002', '', moved.id]);
    assert.ok(o1.paymentCorrections.length === 3 && o2.paymentCorrections.length === 1, 'both orders show the move');
    r = await correct(moved.id, { amount:100, targetOrderId:'ORD-0003', confirmOtherCustomer:true, reason:'دفعة منى' });
    assert.equal(r.status, 200, r.text);
    d = db();
    assert.deepEqual([find(d.onlineOrders, 'ORD-0002').paidAmount, find(d.onlineOrders, 'ORD-0003').paidAmount, find(d.orderPayments, r.body.correction.newPaymentId).customerId], [0, 100, 'C0002']);
    console.log('PASS wrong order: moves to the right order (another customer only after confirmation); both orders and plans follow');

    // ---- Never arrived / entered twice: cancel it.
    const onThree = r.body.correction.newPaymentId;
    r = await correct(onThree, { cancelPayment:true, reason:'الفلوس ما وصلتش' });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.correction.kind, 'cancel'); assert.equal(r.body.correction.newPaymentId, '');
    d = db();
    const o3 = find(d.onlineOrders, 'ORD-0003');
    assert.deepEqual([o3.paidAmount, o3.remainingAmount, o3.paymentStatus, o3.paymentPlan], [0, 150, 'unpaid', 'cash_on_delivery']);
    assert.equal(d.cash.filter(row => !row.deletedAt && row.orderId === 'ORD-0003').length, 0);
    console.log('PASS never arrived / entered twice: the payment and its cash row are reversed, the order is unpaid again');

    // ---- Invoiced and shipped (not yet collected): invoice, customer balance and the shipment's collection amount follow.
    r = await correct('PAY-E', { amount:150, cashAccountId:'CA-001', paymentMethod:'كاش', reason:'العميل دفع 150' });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.carrierNotice, true);
    d = db();
    const sale = find(d.sales, 'INV-0001'), shipment = find(d.shipments, 'SH-0001'), o5 = find(d.onlineOrders, 'ORD-0005');
    assert.deepEqual([sale.paid, sale.remaining, sale.paymentStatus], [150, 250, 'partially_paid']);
    assert.equal(find(d.customers, 'C0001').balance, 250, 'customer balance 300 → 250');
    assert.deepEqual([shipment.collectionAmount, o5.amountDueAtDelivery], [250, 250]);
    assert.equal(find(d.orderPayments, r.body.correction.newPaymentId).invoiceId, 'INV-0001');
    console.log('PASS invoiced and shipped: invoice and customer balance updated, shipment collection 300→250 with a notice to tell the carrier');

    // ---- Refused: cancelled order, carrier collection recorded, closed day.
    r = await preview('PAY-D'); assert.equal(r.body.blocked.code, 'ORDER_CANCELLED');
    r = await correct('PAY-D', { amount:10, reason:'تجربة' }); assert.equal(r.status, 409); assert.equal(r.body.code, 'ORDER_CANCELLED');
    r = await correct('PAY-G', { amount:10, reason:'تجربة' }); assert.equal(r.status, 409); assert.equal(r.body.code, 'ORDER_COLLECTED');
    r = await correct('PAY-F', { amount:10, reason:'تجربة' }); assert.equal(r.status, 409); assert.equal(r.body.code, 'DAY_CLOSED');
    assert.deepEqual(['PAY-D', 'PAY-F', 'PAY-G'].map(id => find(db().orderPayments, id).status), ['confirmed', 'confirmed', 'confirmed']);
    console.log('PASS refused with a clear reason: cancelled order, carrier collection already recorded, closed day');

    // ---- A quick order whose payment was cancelled can record the real payment again.
    r = await system.api('/api/orders/quick', { username:'cashier', method:'POST', body:{ requestId:'pc-quick-1', phone:'01009998887', customerName:'سارة', governorate:'القاهرة', address:'شارع 2', shippingCost:0,
      lines:[{ bookId:'B0001', qty:2, discount:0, discountType:'percent' }], paymentPlan:'advance_cod', paidAmount:50, paymentConfirmed:true, cashAccountId:'CA-003', receiptMethod:'InstaPay' } });
    assert.equal(r.status, 201, r.text);
    const quick = r.body.order;
    const quickPayment = db().orderPayments.find(row => row.orderId === quick.id && row.status === 'confirmed');
    r = await correct(quickPayment.id, { cancelPayment:true, reason:'اتسجّلت بالغلط' });
    assert.equal(r.status, 200, r.text);
    r = await system.api(`/api/orders/${quick.id}/quick`, { username:'cashier', method:'PATCH', body:{ requestId:'pc-quick-1', phone:'01009998887', customerName:'سارة', governorate:'القاهرة', address:'شارع 2', shippingCost:0,
      lines:[{ bookId:'B0001', qty:2, discount:0, discountType:'percent' }], paymentPlan:'advance_cod', paidAmount:100, paymentConfirmed:true, cashAccountId:'CA-003', receiptMethod:'InstaPay' } });
    assert.equal(r.status, 200, r.text);
    d = db();
    assert.equal(find(d.onlineOrders, quick.id).paidAmount, 100);
    assert.equal(d.orderPayments.filter(row => row.orderId === quick.id && row.status === 'confirmed').length, 1);
    console.log('PASS quick order: after cancelling a wrong payment the real one can be recorded again from the order screen');

    console.log('ALL PASS payment correction');
  } catch (error) {
    console.error(error);
    if (system) console.error(system.output().slice(-3000));
    process.exitCode = 1;
  } finally {
    system?.stop(); store?.close?.();
  }
})();
