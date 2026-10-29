'use strict';
// Website order review and atomic approval (ARCHITECTURE_TO_BE §7, INTEGRATION_API_SPEC §5) against a mock Store.
const assert = require('node:assert/strict');
const H = require('./integration-test-helpers.js');

const item = (bookId, quantity, unitPrice, extra = {}) => ({ productId:Number(bookId.slice(1)), externalBookId:bookId, nameAr:`كتاب ${bookId}`, quantity, unitPrice, subtotal:quantity * unitPrice, availabilityAtOrder:'available', preorderQuantity:0, ...extra });

(async () => {
  let system, store;
  try {
    store = await H.startMockStore();
    const db = H.fixtureDb();
    db.books = [
      { id:'B0001', name:'رياضيات', price:100, cost:60, stock:50, reservedStock:0, supplierId:'S001' },
      { id:'B0002', name:'آخر نسخة', price:50, cost:30, stock:1, reservedStock:0, supplierId:'S001' },
      { id:'B0003', name:'حجز مسبق', price:80, cost:40, stock:0, reservedStock:0, allowPreorder:true, supplierId:'S001' },
      { id:'B0004', name:'غير متوفر', price:70, cost:40, stock:0, reservedStock:0, allowPreorder:false, supplierId:'S001' },
      { id:'B0005', name:'نسخة وحجز', price:60, cost:30, stock:1, reservedStock:0, allowPreorder:true, supplierId:'S001' },
      { id:'B0099', name:'محذوف', price:10, stock:5, deletedAt:'2026-10-01T00:00:00.000Z' }
    ];
    db.customers = [{ id:'C0001', name:'عميل قديم', phone:'201001112223', governorate:'الجيزة', address:'قديم', createdAt:'2026-01-01T00:00:00.000Z' }];
    system = await H.startSystem({ db, env:H.integrationEnv(store), name:'website-approval-' });
    const add = order => { store.state.orders.set(order.orderNumber, order); return order; };
    const approve = (order, body = {}, username = 'cashier') => system.api(`/api/website-orders/${order.orderNumber}/approve`, { username, method:'POST', body:{ deposit:H.deposit(), shippingCompany:'البريد المصري', ...body } });
    const ordersFor = number => system.readDb().onlineOrders.filter(order => order.websiteOrderNumber === number);
    const book = id => system.readDb().books.find(row => row.id === id);

    // ---- Permissions and list/preview.
    const a = add(H.storeOrder({ items:[item('B0001', 2, 100)], depositRequired:100 }));
    add(H.storeOrder({ status:'confirmed', salesOrderId:'ORD-9999' }));
    assert.equal((await system.api('/api/website-orders', { username:'warehouse' })).status, 403);
    assert.equal((await system.api('/api/website-orders', { token:'' })).status, 401);
    let r = await system.api('/api/website-orders', { username:'cashier' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.orders.map(order => order.orderNumber), [a.orderNumber], 'only pending orders');
    assert.equal(r.body.orders[0].lines[0].status, 'available'); assert.equal(r.body.orders[0].depositRequired, 100);
    assert.ok(store.state.requests.every(request => request.verified && request.keyId === 'system-v1'), 'every Store call is signed with system-v1');
    r = await system.api(`/api/website-orders/${a.orderNumber}`, { username:'cashier' });
    assert.equal(r.status, 200);
    assert.equal(r.body.pending, true); assert.equal(r.body.totalMatches, true); assert.deepEqual(r.body.priceDiffs, []); assert.deepEqual(r.body.shortages, []);
    assert.equal(r.body.permissions.approve, true); assert.equal(r.body.permissions.depositOverride, false);
    assert.equal((await system.api('/api/website-orders/MK261020-00000', { username:'cashier' })).status, 404);
    assert.equal((await system.api('/api/website-orders/not-a-number', { username:'cashier' })).status, 400);
    assert.equal((await approve(a, {}, 'shipping')).status, 403);
    console.log('PASS website orders list/preview need order.website.view; Store calls are signed');

    // ---- Happy path: one order, reserved stock, deposit with transfer details, Store notified.
    const aDeposit = H.deposit({ senderName:'أحمد', reference:'TX 1234-56' });
    r = await approve(a, { deposit:aDeposit, notes:'اتصال قبل الشحن' });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.storeNotified, true);
    const created = r.body.order;
    assert.match(created.id, /^ORD-\d{4}$/);
    assert.equal(created.source, 'website'); assert.equal(created.sourcePlatform, 'store'); assert.equal(created.websiteOrderNumber, a.orderNumber);
    assert.equal(created.websiteOrderId, a.id); assert.equal(created.integrationId, a.integrationId);
    assert.equal(created.workflowStage, 'awaiting_preparation'); assert.equal(created.status, 'قيد التجهيز');
    assert.equal(created.total, 235); assert.equal(created.shippingCost, 35); assert.equal(created.lines[0].price, 100);
    assert.equal(created.paidAmount, 100); assert.equal(created.remainingAmount, 135); assert.equal(created.paymentStatus, 'partially_paid');
    assert.equal(created.depositRequired, 100); assert.equal(created.deposit.amount, 100); assert.equal(created.deposit.defaultAtApproval, 100);
    let stored = system.readDb();
    assert.equal(stored.books.find(row => row.id === 'B0001').reservedStock, 2);
    const payment = stored.orderPayments.find(row => row.orderId === created.id);
    assert.equal(payment.amount, 100); assert.equal(payment.senderPhone, aDeposit.senderPhone); assert.equal(payment.senderName, 'أحمد'); assert.equal(payment.transferReference, 'TX 1234-56'); assert.equal(payment.transferReferenceNormalized, 'TX123456'); assert.equal(payment.cashAccountId, 'CA-003');
    assert.ok(stored.cash.some(row => row.paymentId === payment.id && row.amount === 100), 'cash receipt row');
    const customer = stored.customers.find(row => row.id === created.customerId);
    assert.equal(customer.phone, '01001234567'); assert.equal(customer.type, 'أونلاين');
    assert.ok(stored.audit.some(row => row.entityId === created.id && /اعتماد طلب الموقع/.test(row.action)));
    const link = store.state.requests.find(request => request.path.endsWith('/sales-link'));
    assert.equal(link.body.salesOrderId, created.id); assert.equal(link.body.workflowStage, 'awaiting_preparation'); assert.equal(link.body.approvedBy, 'cashier'); assert.equal(link.body.depositAmount, 100);
    assert.equal(store.state.orders.get(a.orderNumber).salesOrderId, created.id);
    console.log('PASS approval creates one confirmed order, reserves stock, records the deposit and notifies the Store');

    r = await approve(a);
    assert.equal(r.status, 200); assert.equal(r.body.existing, true); assert.equal(r.body.order.id, created.id);
    assert.equal(ordersFor(a.orderNumber).length, 1);
    store.state.down = true;
    r = await approve(a);
    assert.equal(r.status, 200, 'a retry of a finished approval succeeds even while the Store is down'); assert.equal(r.body.storeNotified, false);
    store.state.down = false;
    console.log('PASS a retry returns the same order (idempotent on websiteOrderNumber)');

    // ---- Two concurrent approvals of the same website order create one order.
    const b = add(H.storeOrder({ items:[item('B0001', 1, 100)] }));
    store.state.delayMs = 150;
    const [b1, b2] = await Promise.all([approve(b), approve(b)]);
    store.state.delayMs = 0;
    assert.deepEqual([b1.status, b2.status].sort(), [200, 201], `${b1.text} ${b2.text}`);
    assert.equal(b1.body.order.id, b2.body.order.id);
    assert.equal(ordersFor(b.orderNumber).length, 1);
    console.log('PASS two concurrent approvals of the same website order create exactly one order');

    // ---- Two orders race for the last copy of a book without pre-order: one reserves, the other is refused.
    const c = add(H.storeOrder({ items:[item('B0002', 1, 50)], depositRequired:85 }));
    const d = add(H.storeOrder({ items:[item('B0002', 1, 50)], depositRequired:85 }));
    store.state.delayMs = 100;
    const [c1, d1] = await Promise.all([approve(c, { deposit:H.deposit({ amount:85 }) }), approve(d, { deposit:H.deposit({ amount:85 }) })]);
    store.state.delayMs = 0;
    const statuses = [c1.status, d1.status].sort();
    assert.deepEqual(statuses, [201, 409], `${c1.text} ${d1.text}`);
    const refused = [c1, d1].find(result => result.status === 409);
    assert.equal(refused.body.code, 'OUT_OF_STOCK'); assert.equal(refused.body.lines[0].bookId, 'B0002'); assert.equal(refused.body.lines[0].available, 0);
    assert.equal(book('B0002').reservedStock, 1);
    assert.equal(system.readDb().onlineOrders.filter(order => [c.orderNumber, d.orderNumber].includes(order.websiteOrderNumber)).length, 1, 'the refused order wrote nothing');
    console.log('PASS last copy without pre-order: one order reserves it, the other gets 409 OUT_OF_STOCK');

    // ---- Same race for a book that allows pre-order, with consent: the second waits in awaiting_stock (Option A).
    const e = add(H.storeOrder({ items:[item('B0005', 1, 60)], preorderConsent:true, depositRequired:95 }));
    const f = add(H.storeOrder({ items:[item('B0005', 1, 60)], preorderConsent:true, depositRequired:95 }));
    store.state.delayMs = 100;
    const [e1, f1] = await Promise.all([approve(e, { deposit:H.deposit({ amount:95 }), preorderConsent:{ B0005:true } }), approve(f, { deposit:H.deposit({ amount:95 }), preorderConsent:{ B0005:true } })]);
    store.state.delayMs = 0;
    assert.equal(e1.status, 201, e1.text); assert.equal(f1.status, 201, f1.text);
    const stages = [e1.body.order.workflowStage, f1.body.order.workflowStage].sort();
    assert.deepEqual(stages, ['awaiting_preparation', 'awaiting_stock']);
    const waiting = [e1, f1].find(result => result.body.order.workflowStage === 'awaiting_stock').body.order;
    assert.equal(waiting.status, 'حجز مسبق'); assert.deepEqual(waiting.backorderLines, [{ bookId:'B0005', qty:1 }]); assert.equal(waiting.inventoryReservation.status, 'released');
    assert.deepEqual(waiting.preorderConsent, { B0005:true });
    assert.equal(book('B0005').reservedStock, 1, 'the pre-order holds no copy');
    console.log('PASS last copy with pre-order + consent: one reserves, the other becomes a pre-order (awaiting_stock)');

    // ---- Pre-order rules.
    const g = add(H.storeOrder({ items:[item('B0003', 1, 80)], preorderConsent:false, depositRequired:100 }));
    r = await approve(g, { preorderConsent:{ B0003:true } });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'PREORDER_CONSENT_REQUIRED'); assert.equal(r.body.lines[0].customerConsentRecorded, false);
    const g2 = add(H.storeOrder({ items:[item('B0003', 1, 80)], preorderConsent:true, depositRequired:100 }));
    r = await approve(g2);
    assert.equal(r.status, 409); assert.equal(r.body.code, 'PREORDER_CONSENT_REQUIRED'); assert.equal(r.body.lines[0].employeeConfirmed, false);
    const h = add(H.storeOrder({ items:[item('B0004', 1, 70)], preorderConsent:true, depositRequired:100 }));
    r = await approve(h);
    assert.equal(r.body.code, 'OUT_OF_STOCK');
    r = await approve(h, { preorderConsent:{ B0004:true } });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'PREORDER_NOT_ALLOWED', 'no pre-order without allowPreorder, even with consent');
    assert.equal(ordersFor(g.orderNumber).length + ordersFor(g2.orderNumber).length + ordersFor(h.orderNumber).length, 0);
    console.log('PASS pre-order refused without customer/employee consent or without allowPreorder');

    // ---- Deposit rules.
    const i = add(H.storeOrder({ items:[item('B0001', 1, 100)], depositRequired:100 }));
    r = await approve(i, { deposit:H.deposit({ amount:50 }) });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'DEPOSIT_TOO_LOW'); assert.equal(r.body.required, 100); assert.equal(r.body.overrideAllowed, false);
    r = await approve(i, { deposit:H.deposit({ amount:50, overrideReason:'عميل دائم' }) });
    assert.equal(r.body.code, 'DEPOSIT_TOO_LOW', 'a cashier cannot override the deposit');
    r = await approve(i, { deposit:H.deposit({ amount:50 }) }, 'manager');
    assert.equal(r.body.code, 'DEPOSIT_TOO_LOW', 'override needs a reason'); assert.equal(r.body.overrideAllowed, true);
    r = await approve(i, { deposit:H.deposit({ amount:100, receivedConfirmed:false }) });
    assert.equal(r.body.code, 'DEPOSIT_NOT_CONFIRMED');
    r = await approve(i, { deposit:H.deposit({ amount:500 }) });
    assert.equal(r.body.code, 'DEPOSIT_EXCEEDS_TOTAL');
    r = await approve(i, { deposit:H.deposit({ cashAccountId:'CA-404' }) });
    assert.equal(r.body.code, 'CASH_ACCOUNT_REQUIRED');
    r = await approve(i, { deposit:H.deposit({ senderPhone:'', reference:'' }) });
    assert.equal(r.body.code, 'TRANSFER_DETAILS_REQUIRED');
    assert.equal(ordersFor(i.orderNumber).length, 0);
    r = await approve(i, { deposit:H.deposit({ amount:50, overrideReason:'عميل دائم' }) }, 'manager');
    assert.equal(r.status, 201, r.text); assert.equal(r.body.order.deposit.override, true); assert.equal(r.body.order.deposit.overrideReason, 'عميل دائم'); assert.equal(r.body.order.paidAmount, 50);
    console.log('PASS deposit below the required amount is refused unless order.deposit.override with a reason');

    // ---- Duplicate transfer detection (normalized reference, or sender phone + amount within 24 h).
    const j = add(H.storeOrder({ items:[item('B0001', 1, 100)] }));
    r = await approve(j, { deposit:H.deposit({ reference:'tx123456' }) });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'DUPLICATE_TRANSFER_SUSPECTED');
    assert.equal(r.body.matches[0].orderId, created.id); assert.equal(r.body.matches[0].matchedBy, 'reference'); assert.equal(r.body.matches[0].websiteOrderNumber, a.orderNumber);
    r = await approve(j, { deposit:H.deposit({ senderPhone:`+2${aDeposit.senderPhone}` }) });
    assert.equal(r.body.code, 'DUPLICATE_TRANSFER_SUSPECTED'); assert.equal(r.body.matches[0].matchedBy, 'sender_phone_amount');
    r = await system.api(`/api/website-orders/${j.orderNumber}?reference=TX-123456`, { username:'cashier' });
    assert.equal(r.body.duplicateTransferWarnings[0].orderId, created.id, 'preview warns before submitting');
    r = await approve(j, { deposit:H.deposit({ reference:'TX123456' }), duplicateTransferReviewed:true });
    assert.equal(r.status, 201, r.text);
    console.log('PASS duplicate transfer reference / sender+amount flagged unless reviewed');

    // ---- The website price (Store-managed price/discount) is the agreed price and never blocks approval.
    const l = add(H.storeOrder({ items:[item('B0001', 2, 90)] }));
    r = await system.api(`/api/website-orders/${l.orderNumber}`, { username:'cashier' });
    assert.deepEqual(r.body.priceDiffs, [{ bookId:'B0001', name:'كتاب B0001', websitePrice:90, systemPrice:100 }]);
    r = await approve(l);
    assert.equal(r.status, 201); assert.equal(r.body.order.lines[0].price, 90); assert.equal(r.body.order.total, 215); assert.equal(r.body.order.priceChangesAcknowledged.length, 1);
    console.log('PASS the website price is the agreed price; the System price difference is recorded, not blocking');

    // ---- Coupon, existing customer by normalized phone, total mismatch, unlinked products, not pending.
    const coupon = add(H.storeOrder({ items:[item('B0001', 1, 100)], couponDiscount:20, depositRequired:100, customer:{ name:'عميل قديم', mobile:'01001112223', altMobile:null } }));
    r = await approve(coupon);
    assert.equal(r.status, 201, r.text); assert.equal(r.body.order.total, 115); assert.equal(r.body.order.orderDiscount, 20); assert.equal(r.body.order.orderDiscountType, 'amount');
    assert.equal(r.body.order.customerId, 'C0001', 'existing customer found by normalized phone');
    assert.equal(system.readDb().customers.filter(row => row.id === 'C0001').length, 1);
    const mismatch = add(H.storeOrder({ items:[item('B0001', 1, 100)], total:999 }));
    assert.equal((await approve(mismatch)).body.code, 'WEBSITE_ORDER_TOTAL_MISMATCH');
    const unlinked = add(H.storeOrder({ items:[item('B0001', 1, 100, { externalBookId:null })] }));
    r = await approve(unlinked);
    assert.equal(r.status, 409); assert.equal(r.body.code, 'PRODUCT_NOT_LINKED');
    const deleted = add(H.storeOrder({ items:[item('B0099', 1, 10)], depositRequired:45 }));
    assert.equal((await approve(deleted, { deposit:H.deposit({ amount:45 }) })).body.code, 'PRODUCT_NOT_LINKED');
    const archived = add(H.storeOrder({ archived:true }));
    assert.equal((await approve(archived)).body.code, 'WEBSITE_ORDER_NOT_PENDING');
    const linkedElsewhere = add(H.storeOrder({ salesOrderId:'ORD-0777' }));
    assert.equal((await approve(linkedElsewhere)).body.code, 'WEBSITE_ORDER_NOT_PENDING');
    console.log('PASS coupon, existing customer reuse, total mismatch, unlinked/deleted products and non-pending orders');

    // ---- Store down or unreachable → 502 and nothing written.
    const m = add(H.storeOrder({ items:[item('B0001', 1, 100)] }));
    const revisionBefore = system.readDb().meta.dataRevision;
    store.state.down = true;
    r = await approve(m);
    assert.equal(r.status, 502); assert.equal(r.body.code, 'STORE_UNAVAILABLE');
    store.state.down = false;
    assert.equal(system.readDb().meta.dataRevision, revisionBefore, 'no write happened');
    assert.equal(ordersFor(m.orderNumber).length, 0);
    assert.equal((await system.api('/api/website-orders', { username:'cashier' })).status, 200);
    console.log('PASS Store down → 502 STORE_UNAVAILABLE with no write');

    // ---- Store notification failure still returns 201; a retry re-notifies.
    const n = add(H.storeOrder({ items:[item('B0001', 1, 100)] }));
    store.state.salesLinkStatus = 500;
    r = await approve(n);
    assert.equal(r.status, 201); assert.equal(r.body.storeNotified, false);
    store.state.salesLinkStatus = 200;
    r = await approve(n);
    assert.equal(r.status, 200); assert.equal(r.body.storeNotified, true); assert.equal(store.state.orders.get(n.orderNumber).salesOrderId, r.body.order.id);
    console.log('PASS a failed Store notification still returns 201 (storeNotified:false); the retry links it');

    // ---- Changing the default deposit does not change existing orders; a new order without a snapshot uses it.
    const beforeDefault = system.readDb().onlineOrders.filter(order => order.websiteOrderNumber).map(order => [order.id, order.depositRequired, order.deposit.required]);
    r = await system.api('/api/settings/website-deposit', { username:'owner', method:'PUT', body:{ depositDefault:150, expectedRevision:String(system.readDb().meta.dataRevision) } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(system.readDb().onlineOrders.filter(order => order.websiteOrderNumber).map(order => [order.id, order.depositRequired, order.deposit.required]), beforeDefault);
    const noSnapshot = add(H.storeOrder({ items:[item('B0001', 2, 100)], depositRequired:null }));
    r = await system.api(`/api/website-orders/${noSnapshot.orderNumber}`, { username:'cashier' });
    assert.equal(r.body.depositRequired, 150);
    assert.equal((await approve(noSnapshot)).body.code, 'DEPOSIT_TOO_LOW');
    r = await approve(noSnapshot, { deposit:H.deposit({ amount:150 }) });
    assert.equal(r.status, 201); assert.equal(r.body.order.depositRequired, 150); assert.equal(r.body.order.deposit.defaultAtApproval, 150);
    console.log('PASS changing the default deposit affects new orders only');

    // ---- Pre-orders + stock receipt: a client-style PUT adding stock lets auto-allocation move the oldest complete order.
    const p1 = add(H.storeOrder({ items:[item('B0003', 1, 80)], preorderConsent:true, depositRequired:100 }));
    const p2 = add(H.storeOrder({ items:[item('B0003', 1, 80)], preorderConsent:true, depositRequired:100 }));
    const first = await approve(p1, { preorderConsent:{ B0003:true } });
    await H.sleep(20);
    const second = await approve(p2, { preorderConsent:{ B0003:true } });
    assert.equal(first.body.order.workflowStage, 'awaiting_stock'); assert.equal(second.body.order.workflowStage, 'awaiting_stock');
    await H.sleep(1700); // let the post-write allocation pass settle
    const full = await system.api('/api/db', { username:'warehouse' });
    full.body.stockMovements = [...(full.body.stockMovements || []), { id:'MOV-TEST-1', bookId:'B0003', type:'شراء', quantity:1, before:0, after:1 }];
    full.body.inventoryBatches = [...(full.body.inventoryBatches || []), { id:'BAT-TEST-1', batchId:'BAT-TEST-1', productId:'B0003', receivedQty:1, remainingQty:1, unitCost:30 }];
    full.body.books.find(row => row.id === 'B0003').stock = 1;
    const put = await system.api('/api/db', { username:'warehouse', method:'PUT', body:full.body, headers:{ 'If-Match':full.headers.get('x-db-revision') } });
    assert.equal(put.status, 200, put.text);
    await H.until(() => system.readDb().onlineOrders.find(order => order.id === first.body.order.id).workflowStage === 'awaiting_preparation', 'auto-allocation');
    stored = system.readDb();
    assert.equal(stored.onlineOrders.find(order => order.id === first.body.order.id).carriedOverFromBackorder, true);
    assert.equal(stored.onlineOrders.find(order => order.id === second.body.order.id).workflowStage, 'awaiting_stock', 'the newer pre-order keeps waiting');
    assert.equal(stored.books.find(row => row.id === 'B0003').reservedStock, 1);
    console.log('PASS after receiving stock, auto-allocation moves the oldest complete website pre-order to preparation');

    assert.ok(!system.output().includes(H.SECRET), 'secret never logged');
    console.log('PASS website order approval checks completed');
  } finally {
    if (system) system.stop();
    if (store) await store.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
