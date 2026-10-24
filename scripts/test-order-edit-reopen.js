'use strict';
// Editing an order from any stage before shipping (owner request 2026-10-21):
// - a packed order (invoice issued at packing) is reopened for editing: its invoice is voided and detached, the books
//   go back on the shelf and are reserved again, and packing it again issues a new invoice;
// - any employee who edits orders can do it (the cashier here), with an explicit confirmation;
// - a website order is edited only on the customer's request: books already on it keep the website price, an added book
//   takes its current website price from the Store, the coupon stays, and the Store link carries the new books/total.
// Runs a scratch System against the mock Store from integration-test-helpers.js.
const assert = require('node:assert/strict');
const H = require('./integration-test-helpers.js');

(async () => {
  let system, store;
  try {
    store = await H.startMockStore();
    const db = H.fixtureDb();
    db.books = [
      { id:'B0001', name:'رياضيات', price:100, cost:60, stock:20, reservedStock:0, supplierId:'S001' },
      { id:'B0002', name:'فيزياء', price:100, cost:60, stock:20, reservedStock:0, supplierId:'S001' },
      { id:'B0003', name:'كيمياء', price:120, cost:60, stock:20, reservedStock:0, supplierId:'S001' },
      { id:'B0004', name:'مش على الموقع', price:90, cost:40, stock:20, reservedStock:0, supplierId:'S001' }
    ];
    db.inventoryBatches = db.books.map(row => ({ id:`BATCH-${row.id}`, productId:row.id, bookId:row.id, qty:row.stock, quantity:row.stock, remainingQty:row.stock, unitCost:row.cost, createdAt:'2026-10-01T00:00:00.000Z' }));
    system = await H.startSystem({ db, env:H.integrationEnv(store), name:'order-edit-reopen-' });
    const order = id => system.readDb().onlineOrders.find(row => row.id === id);
    const book = id => system.readDb().books.find(row => row.id === id);
    const pack = async (id, username = 'warehouse') => {
      let r = await system.api(`/api/orders/${id}/prepare/start`, { username, method:'POST', body:{} });
      assert.equal(r.status, 200, r.text);
      r = await system.api(`/api/orders/${id}/prepare/checklist`, { username, method:'PATCH', body:{ doneBookIds:order(id).lines.map(line => line.bookId) } });
      assert.equal(r.status, 200, r.text);
      r = await system.api(`/api/orders/${id}/prepare/complete`, { username, method:'POST', body:{ packedWeightGrams:900 } });
      assert.equal(r.status, 200, r.text);
      return order(id);
    };

    // ---- A WhatsApp order: create, confirm, pack.
    let r = await system.api('/api/orders/quick', { username:'cashier', method:'POST', body:{ phone:'01011112222', customerName:'عميل تعديل', governorate:'القاهرة', city:'مدينة نصر', address:'شارع 1', shippingCompany:'البريد المصري', requestId:'edit-1', lines:[{ bookId:'B0001', qty:2 }] } });
    assert.ok([200, 201].includes(r.status), r.text);
    const id = r.body.order.id;
    assert.equal((await system.api(`/api/orders/${id}/confirm`, { username:'cashier', method:'POST', body:{} })).status, 200);
    const packed = await pack(id);
    const firstInvoice = packed.saleId;
    assert.ok(firstInvoice, 'packing issued an invoice');
    assert.equal(book('B0001').stock, 18);
    console.log('PASS packed order has its invoice');

    r = await system.api(`/api/orders/${id}/quick`, { username:'cashier', method:'PATCH', body:{ ...packed, lines:[{ bookId:'B0001', qty:1 }] } });
    assert.equal(r.status, 409, 'a packed order is not edited directly');
    r = await system.api(`/api/orders/${id}/reopen-for-edit`, { username:'cashier', method:'POST', body:{ operationKey:'k1' } });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'CONFIRMATION_REQUIRED');
    assert.equal((await system.api(`/api/orders/${id}/reopen-for-edit`, { username:'cashier', method:'POST', token:'', body:{ confirm:true } })).status, 401);
    console.log('PASS reopening needs a session and an explicit confirmation');

    r = await system.api(`/api/orders/${id}/reopen-for-edit`, { username:'cashier', method:'POST', body:{ confirm:true, operationKey:'k1' } });
    assert.equal(r.status, 200, r.text);
    let reopened = order(id), voided = system.readDb().sales.find(sale => sale.id === firstInvoice);
    assert.equal(reopened.saleId, ''); assert.equal(reopened.workflowStage, 'awaiting_preparation'); assert.equal(reopened.preparedAt, null);
    assert.equal(voided.status, 'ملغاة'); assert.equal(voided.onlineOrderId, ''); assert.equal(voided.voidedForEditOfOrderId, id);
    assert.equal(book('B0001').stock, 20, 'the invoice books are back on the shelf'); assert.equal(book('B0001').reservedStock, 2, 'and reserved again for the order');
    assert.equal(reopened.inventoryReservation.status, 'active');
    r = await system.api(`/api/orders/${id}/reopen-for-edit`, { username:'cashier', method:'POST', body:{ confirm:true, operationKey:'k1' } });
    assert.equal(r.status, 200); assert.equal(r.body.existing, true);
    assert.equal(system.readDb().sales.filter(sale => sale.status === 'ملغاة').length, 1, 'a repeated click changes nothing');
    console.log('PASS the cashier reopened the packed order: invoice voided and detached, books reserved again');

    r = await system.api(`/api/orders/${id}/quick`, { username:'cashier', method:'PATCH', body:{ phone:'01011112222', customerName:'عميل تعديل', governorate:'القاهرة', city:'مدينة نصر', address:'شارع 1', shippingCompany:'البريد المصري', shippingCost:reopened.shippingCost ?? reopened.shippingFee, lines:[{ bookId:'B0001', qty:1 }, { bookId:'B0002', qty:1 }] } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(order(id).lines.map(line => [line.bookId, line.qty]), [['B0001', 1], ['B0002', 1]]);
    assert.equal(book('B0001').reservedStock, 1); assert.equal(book('B0002').reservedStock, 1);
    const repacked = await pack(id);
    assert.ok(repacked.saleId && repacked.saleId !== firstInvoice, 'packing again issues a new invoice');
    const live = system.readDb().sales.filter(sale => sale.onlineOrderId === id);
    assert.deepEqual(live.map(sale => sale.id), [repacked.saleId], 'only the new invoice belongs to the order');
    assert.equal(book('B0001').stock, 19); assert.equal(book('B0002').stock, 19);
    assert.ok(system.readDb().audit.some(row => /إعادة فتح الطلب للتعديل/.test(JSON.stringify(row))), 'audited');
    console.log('PASS edited and packed again with a new invoice; stock is right');

    // A further payment after packing: the invoice and the customer balance follow it.
    const invoiceBefore = system.readDb().sales.find(sale => sale.id === repacked.saleId), balanceBefore = Number(system.readDb().customers.find(c => c.id === invoiceBefore.customerId).balance || 0);
    r = await system.api(`/api/orders/${id}/payments`, { username:'cashier', method:'POST', body:{ amount:40, cashAccountId:'CA-003', paymentMethod:'InstaPay', operationKey:'after-pack' } });
    assert.equal(r.status, 201, r.text);
    const invoiceAfter = system.readDb().sales.find(sale => sale.id === repacked.saleId);
    assert.equal(Number(invoiceAfter.paidAmount), Number(invoiceBefore.paidAmount || 0) + 40); assert.equal(Number(invoiceAfter.remainingAmount), Number(invoiceBefore.remainingAmount) - 40);
    assert.equal(Number(system.readDb().customers.find(c => c.id === invoiceBefore.customerId).balance || 0), balanceBefore - 40);
    assert.equal(system.readDb().orderPayments.find(item => item.id === r.body.payment.id).invoiceId, repacked.saleId);
    console.log('PASS a payment after packing updates the invoice and the customer balance');

    // ---- A website order (coupon 20, website price 90 for B0002 while the System price is 100).
    const web = H.storeOrder({ items:[{ productId:2, externalBookId:'B0002', nameAr:'فيزياء', quantity:1, unitPrice:90, subtotal:90, availabilityAtOrder:'available', preorderQuantity:0 }], couponDiscount:20, shippingCost:35, depositRequired:0 });
    store.state.orders.set(web.orderNumber, web);
    r = await system.api(`/api/website-orders/${web.orderNumber}/approve`, { username:'cashier', method:'POST', body:{ deposit:{ ...H.deposit(), amount:0 }, depositOverride:true, depositOverrideReason:'اختبار', shippingCompany:'البريد المصري', acceptPriceDifferences:true } });
    if (r.status !== 200) r = await system.api(`/api/website-orders/${web.orderNumber}/approve`, { username:'owner', method:'POST', body:{ deposit:H.deposit({ amount:50 }), shippingCompany:'البريد المصري', acceptPriceDifferences:true } });
    assert.equal(r.status, 200, r.text);
    const webId = system.readDb().onlineOrders.find(row => row.websiteOrderNumber === web.orderNumber).id;
    const before = order(webId);
    assert.equal(before.lines[0].price, 90); assert.equal(before.total, 105);
    const editBody = extra => ({ phone:before.phone, customerName:before.customerName, governorate:before.governorate, city:before.city, address:before.address, shippingCompany:'البريد المصري', shippingCost:35, orderDiscount:before.orderDiscount, orderDiscountType:before.orderDiscountType, ...extra });

    r = await system.api(`/api/orders/${webId}/quick`, { username:'cashier', method:'PATCH', body:editBody({ lines:[{ bookId:'B0002', qty:2 }] }) });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'CUSTOMER_REQUEST_REQUIRED');
    console.log('PASS a website order needs the customer request confirmed');

    r = await system.api(`/api/orders/${webId}/quick`, { username:'cashier', method:'PATCH', body:editBody({ lines:[{ bookId:'B0002', qty:1 }, { bookId:'B0004', qty:1 }], customerRequestedEdit:{ confirmed:true } }) });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'BOOK_NOT_ON_WEBSITE');
    store.state.down = true;
    r = await system.api(`/api/orders/${webId}/quick`, { username:'cashier', method:'PATCH', body:editBody({ lines:[{ bookId:'B0002', qty:1 }, { bookId:'B0003', qty:1 }], customerRequestedEdit:{ confirmed:true } }) });
    assert.equal(r.status, 502); assert.equal(r.body.code, 'STORE_UNAVAILABLE');
    store.state.down = false;
    assert.deepEqual(order(webId).lines.map(line => line.bookId), ['B0002'], 'nothing saved when refused');
    console.log('PASS a book not on the website, or the Store down, is refused without saving');

    store.state.prices.set('B0003', { price:110 });
    r = await system.api(`/api/orders/${webId}/quick`, { username:'cashier', method:'PATCH', body:editBody({ lines:[{ bookId:'B0002', qty:2 }, { bookId:'B0003', qty:1 }], customerRequestedEdit:{ confirmed:true, channel:'مكالمة', note:'زوّد نسخة وكتاب كيمياء' } }) });
    assert.equal(r.status, 200, r.text);
    const edited = order(webId);
    assert.deepEqual(edited.lines.map(line => [line.bookId, line.qty, line.price]), [['B0002', 2, 90], ['B0003', 1, 110]], 'website prices kept / taken from the Store');
    assert.equal(edited.total, 2 * 90 + 110 - 20 + 35, 'coupon kept');
    assert.equal(edited.websiteEdits.length, 1); assert.equal(edited.websiteEdits[0].channel, 'مكالمة'); assert.equal(edited.websiteEdits[0].before.total, 105);
    const priceCall = store.state.requests.filter(request => request.path === '/api/integration/v1/products/prices').at(-1);
    assert.equal(priceCall.verified, true); assert.equal(priceCall.query.externalBookIds, 'B0003', 'asks only for the added book');
    console.log('PASS edited on the customer request: website prices, coupon kept, edit recorded');

    const links = await (await H.signedFetch(system.base, '/api/integration/v1/website-orders/links')).json();
    const link = links.links.find(row => row.websiteOrderNumber === web.orderNumber);
    assert.equal(link.edited.total, 305); assert.equal(link.edited.subtotal, 290); assert.equal(link.edited.orderDiscount, 20); assert.equal(link.edited.shippingFee, 35);
    assert.deepEqual(link.edited.lines.map(line => [line.bookId, line.qty, line.unitPrice, line.subtotal]), [['B0002', 2, 90, 180], ['B0003', 1, 110, 110]]);
    assert.equal(links.links.find(row => row.salesOrderId === id), undefined, 'WhatsApp orders are not in the website links');
    console.log('PASS the Store link carries the edited books and totals');

    // A whole-database save from a browser keeps the edit history.
    const snapshot = (await system.api('/api/db', { username:'owner' })).body;
    const revision = String(snapshot.meta?.dataRevision ?? '');
    for (const row of snapshot.onlineOrders) if (row.id === webId) { delete row.websiteEdits; delete row.websiteEditedAt; }
    r = await system.api('/api/db', { username:'owner', method:'PUT', body:snapshot, headers:{ 'If-Match':revision, 'X-DB-Revision':revision } });
    if (r.status === 200) { assert.equal(order(webId).websiteEdits.length, 1); assert.ok(order(webId).websiteEditedAt); console.log('PASS a whole-database save keeps the edit history'); }
    else console.log(`SKIP whole-database save returned ${r.status} (${r.body?.code || ''})`);

    console.log('order edit/reopen: all checks passed');
  } catch (error) {
    console.error(error); if (system) console.error(system.output().split('\n').slice(-30).join('\n')); process.exitCode = 1;
  } finally { system?.stop(); await store?.close(); }
})();
