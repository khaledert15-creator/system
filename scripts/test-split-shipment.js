'use strict';
// Partial shipping (Option B): split at website approval and later from the order screen, against a mock Store.
const assert = require('node:assert/strict');
const H = require('./integration-test-helpers.js');

const item = (bookId, quantity, unitPrice) => ({ productId:Number(bookId.slice(1)), externalBookId:bookId, nameAr:`كتاب ${bookId}`, quantity, unitPrice, subtotal:quantity * unitPrice, availabilityAtOrder:'available', preorderQuantity:0 });

(async () => {
  let system, store;
  try {
    store = await H.startMockStore();
    const db = H.fixtureDb();
    db.books = [
      { id:'B0001', name:'متوفر', price:100, cost:60, stock:50, reservedStock:0, supplierId:'S001' },
      { id:'B0005', name:'نسخة واحدة', price:60, cost:30, stock:1, reservedStock:0, allowPreorder:true, supplierId:'S001' },
      { id:'B0006', name:'غير موجود', price:80, cost:40, stock:0, reservedStock:0, allowPreorder:true, supplierId:'S001' },
      { id:'B0007', name:'نسخة ثانية', price:40, cost:20, stock:1, reservedStock:0, allowPreorder:true, supplierId:'S001' }
    ];
    system = await H.startSystem({ db, env:H.integrationEnv(store), name:'split-shipment-' });
    const add = order => { store.state.orders.set(order.orderNumber, order); return order; };
    const approve = (order, body = {}, username = 'owner') => system.api(`/api/website-orders/${order.orderNumber}/approve`, { username, method:'POST', body:{ deposit:H.deposit(), shippingCompany:'البريد المصري', preorderConsent:Object.fromEntries(order.items.map(row => [row.externalBookId, true])), ...body } });
    const split = (id, body = {}, username = 'owner') => system.api(`/api/orders/${id}/split-shipment`, { username, method:'POST', body:{ extraShippingFee:40, customerConsent:true, consentChannel:'واتساب', ...body } });
    const orderById = id => system.readDb().onlineOrders.find(row => row.id === id);
    const book = id => system.readDb().books.find(row => row.id === id);
    const links = async () => (await (await H.signedFetch(system.base, '/api/integration/v1/website-orders/links')).json()).links;

    // ---- Split at approval: B0001×2 ships now; B0005 has 1 of 3, so 1 ships now and 2 wait.
    const a = add(H.storeOrder({ items:[item('B0001', 2, 100), item('B0005', 3, 55)], preorderConsent:true, splitShipmentPreference:'split', splitExtraShippingFee:40, couponDiscount:20 }));
    let r = await system.api(`/api/website-orders/${a.orderNumber}`, { username:'owner' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.split.preference, 'split'); assert.equal(r.body.split.quotedFee, 40); assert.equal(r.body.split.splittable, true);
    assert.deepEqual(r.body.split.rows.map(row => [row.bookId, row.now, row.later]), [['B0001', 2, 0], ['B0005', 1, 2]]);
    assert.equal(r.body.permissions.splitShipment, true);
    r = await approve(a, { splitShipment:{ execute:true, extraShippingFee:40 } });
    assert.equal(r.status, 409, r.text); assert.equal(r.body.code, 'SPLIT_CONSENT_REQUIRED');
    assert.equal(system.readDb().onlineOrders.length, 0, 'a refused split writes nothing (no order, no payment)');
    assert.equal(system.readDb().orderPayments.length, 0);
    r = await approve(a, { splitShipment:{ execute:true, extraShippingFee:40, customerConsent:true } }, 'cashier');
    assert.equal(r.status, 403, r.text); assert.equal(r.body.code, 'SPLIT_PERMISSION_DENIED', 'a cashier may approve but not split by default');
    r = await approve(a, { splitShipment:{ execute:true, extraShippingFee:40, customerConsent:true } });
    assert.equal(r.status, 201, r.text);
    const parent = r.body.order, child = r.body.child;
    assert.ok(child && child.id !== parent.id);
    assert.equal(parent.workflowStage, 'awaiting_preparation'); assert.equal(parent.splitPart, 1); assert.deepEqual(parent.splitShipment.childOrderIds, [child.id]);
    assert.deepEqual(parent.lines.map(line => [line.bookId, line.qty, line.price]), [['B0001', 2, 100], ['B0005', 1, 55]]);
    // Coupon (amount 20) is used on part 1; part 1 keeps the original shipping (35) and the deposit (100).
    assert.equal(parent.total, 200 + 55 - 20 + 35); assert.equal(parent.paidAmount, 100); assert.equal(parent.remainingAmount, parent.total - 100);
    assert.equal(parent.websiteOrderNumber, a.orderNumber);
    assert.equal(child.workflowStage, 'awaiting_stock'); assert.equal(child.splitFromOrderId, parent.id); assert.equal(child.parentWebsiteOrderNumber, a.orderNumber);
    assert.equal(child.websiteOrderNumber, undefined, 'part 2 never claims the website order number');
    assert.deepEqual(child.lines.map(line => [line.bookId, line.qty, line.price]), [['B0005', 2, 55]]);
    assert.equal(child.shippingFee, 40); assert.equal(child.total, 110 + 40); assert.equal(child.paidAmount, 0); assert.equal(child.paymentStatus, 'unpaid');
    assert.notEqual(child.inventoryReservation?.status, 'active'); assert.deepEqual(child.backorderLines, [{ bookId:'B0005', qty:2 }]);
    assert.equal(book('B0001').reservedStock, 2); assert.equal(book('B0005').reservedStock, 1, 'part 1 holds the only copy, part 2 holds none');
    assert.equal(r.body.order.splitShipment.consent.confirmed, true); assert.equal(r.body.order.splitShipment.extraShippingFee, 40);
    assert.ok(system.readDb().audit.some(row => row.entityId === parent.id && /تقسيم الشحن/.test(row.action)));
    assert.ok(system.readDb().audit.some(row => row.entityId === child.id && /الشحنة الثانية/.test(row.action)));
    console.log('PASS split at approval: part 1 ships now with the deposit and coupon, part 2 waits with the agreed fee');

    let link = (await links()).find(row => row.websiteOrderNumber === a.orderNumber);
    assert.equal(link.salesOrderId, parent.id);
    assert.equal(link.splitShipment.extraShippingFee, 40);
    assert.deepEqual(link.splitShipment.parts.map(part => [part.part, part.salesOrderId, part.workflowStage, part.total]), [[1, parent.id, 'awaiting_preparation', parent.total], [2, child.id, 'awaiting_stock', child.total]]);
    assert.equal((await links()).filter(row => row.salesOrderId === child.id).length, 0, 'part 2 is reported inside its website order, not as another one');
    console.log('PASS the Store link lists both parts with their own stage and totals');

    // ---- Retry and nesting.
    r = await split(parent.id);
    assert.equal(r.status, 200, r.text); assert.equal(r.body.existing, true); assert.equal(r.body.child.id, child.id);
    r = await split(child.id);
    assert.equal(r.status, 409); assert.equal(r.body.code, 'ORDER_IS_SPLIT_PART');
    assert.equal(system.readDb().onlineOrders.length, 2);
    console.log('PASS a retry returns the same parts; part 2 is not split again');

    // ---- Split later from the order screen (approved as one pre-order first). B0007 1 of 2, B0006 none.
    const b = add(H.storeOrder({ customer:{ name:'عميل ب', mobile:'01001234568', altMobile:null }, items:[item('B0007', 2, 40), item('B0006', 1, 80)], preorderConsent:true }));
    r = await approve(b);
    assert.equal(r.status, 201, r.text);
    const bOrder = r.body.order;
    assert.equal(bOrder.workflowStage, 'awaiting_stock');
    r = await system.api(`/api/orders/${bOrder.id}/split-shipment`, { username:'owner' });
    assert.equal(r.status, 200); assert.equal(r.body.splittable, true); assert.equal(r.body.suggestedFee.source, 'governorate');
    assert.deepEqual(r.body.rows.map(row => [row.bookId, row.now, row.later]), [['B0007', 1, 1], ['B0006', 0, 1]]);
    assert.equal((await split(bOrder.id, {}, 'cashier')).status, 403);
    r = await split(bOrder.id, { customerConsent:false });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'SPLIT_CONSENT_REQUIRED');
    r = await split(bOrder.id, { extraShippingFee:-1 });
    assert.equal(r.status, 400); assert.equal(r.body.code, 'SPLIT_FEE_INVALID');
    // The deposit (100) is more than part 1 (40 + 35 shipping = 75): refused until settled.
    r = await split(bOrder.id);
    assert.equal(r.status, 409); assert.equal(r.body.code, 'PAID_EXCEEDS_FIRST_SHIPMENT');
    assert.equal(orderById(bOrder.id).workflowStage, 'awaiting_stock'); assert.equal(book('B0007').reservedStock, 0);
    console.log('PASS split from the order screen needs permission, consent and a valid fee, and never leaves paid > part 1');

    const c = add(H.storeOrder({ customer:{ name:'عميل ج', mobile:'01001234569', altMobile:null }, items:[item('B0001', 1, 100), item('B0006', 1, 80)], preorderConsent:true, depositRequired:0 }));
    r = await approve(c, { deposit:{ amount:0 } });
    assert.equal(r.status, 201, r.text); assert.equal(r.body.order.workflowStage, 'awaiting_stock');
    const cId = r.body.order.id;
    r = await split(cId, { extraShippingFee:35, consentNote:'وافق في واتساب' });
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(r.body.order.lines.map(line => [line.bookId, line.qty]), [['B0001', 1]]);
    assert.deepEqual(r.body.child.lines.map(line => [line.bookId, line.qty]), [['B0006', 1]]);
    assert.equal(r.body.order.splitShipment.consent.note, 'وافق في واتساب');
    const cChild = r.body.child.id;
    console.log('PASS split from the order screen moves only the missing book to part 2');

    // ---- Nothing on the shelf: no part 1.
    const d = add(H.storeOrder({ customer:{ name:'عميل د', mobile:'01001234570', altMobile:null }, items:[item('B0006', 2, 80)], preorderConsent:true, depositRequired:0 }));
    r = await approve(d, { deposit:{ amount:0 } });
    assert.equal(r.status, 201, r.text);
    r = await split(r.body.order.id);
    assert.equal(r.status, 409); assert.equal(r.body.code, 'NOTHING_AVAILABLE_NOW');
    console.log('PASS an order with nothing on the shelf cannot be split');

    // ---- A browser save cannot forge or remove split fields.
    const owner = await system.login('owner');
    const revision = (await (await fetch(`${system.base}/api/live-revision`, { headers:{ 'X-Session-Token':owner } })).json()).revision;
    const whole = (await system.api('/api/db', { username:'owner' })).body;
    whole.onlineOrders.find(row => row.id === child.id).splitFromOrderId = 'ORD-FAKE';
    delete whole.onlineOrders.find(row => row.id === parent.id).splitShipment;
    whole.onlineOrders.find(row => row.id === bOrder.id).splitShipment = { childOrderIds:['ORD-FAKE'] };
    r = await system.api('/api/db', { username:'owner', method:'PUT', body:whole, headers:{ 'If-Match':revision } });
    assert.equal(r.status, 200, r.text);
    assert.equal(orderById(child.id).splitFromOrderId, parent.id); assert.deepEqual(orderById(parent.id).splitShipment.childOrderIds, [child.id]);
    assert.equal(orderById(bOrder.id).splitShipment, undefined);
    console.log('PASS split fields are server-owned in whole-database saves');

    // ---- Stock arrives for part 2: it moves to preparation on its own and the Store link follows.
    const rev2 = (await (await fetch(`${system.base}/api/live-revision`, { headers:{ 'X-Session-Token':owner } })).json()).revision;
    const restock = (await system.api('/api/db', { username:'owner' })).body;
    restock.books.find(row => row.id === 'B0005').stock = 3;
    r = await system.api('/api/db', { username:'owner', method:'PUT', body:restock, headers:{ 'If-Match':rev2 } });
    assert.equal(r.status, 200, r.text);
    await H.until(() => orderById(child.id).workflowStage === 'awaiting_preparation', 'part 2 moved to preparation');
    assert.equal(book('B0005').reservedStock, 3, 'part 1 holds 1 copy and part 2 now holds 2');
    link = (await links()).find(row => row.websiteOrderNumber === a.orderNumber);
    assert.deepEqual(link.splitShipment.parts.map(part => part.workflowStage), ['awaiting_preparation', 'awaiting_preparation']);
    console.log('PASS part 2 moves to preparation when its books arrive and the Store link reports it');

    // ---- Inventory invariants.
    const final = system.readDb();
    for (const row of final.books) {
      const held = final.onlineOrders.filter(order => order.inventoryReservation?.status === 'active').flatMap(order => order.inventoryReservation.lines).filter(line => line.bookId === row.id).reduce((sum, line) => sum + line.qty, 0);
      assert.equal(Number(row.reservedStock || 0), held, `reservedStock of ${row.id} equals active reservations`);
      assert.ok(Number(row.reservedStock || 0) <= Number(row.stock || 0), `reserved <= stock for ${row.id}`);
    }
    assert.ok(final.onlineOrders.find(row => row.id === cChild));
    console.log('PASS reserved stock equals active reservations and never exceeds stock');
    console.log('split shipment tests passed');
  } catch (error) {
    console.error(`FAIL ${error.stack || error.message}`);
    if (system) console.error(system.output().slice(-3000));
    process.exitCode = 1;
  } finally {
    system?.stop();
    await store?.close();
  }
})();
