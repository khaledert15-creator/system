'use strict';
// Deposit management: default deposit (permission, history, new orders only) and the required deposit of one order
// (website order before approval through the Store, System order after), never touching what was paid.
const assert = require('node:assert/strict');
const H = require('./integration-test-helpers.js');

const item = (quantity = 2, unitPrice = 100) => ({ productId:1, externalBookId:'B0001', nameAr:'كتاب B0001', quantity, unitPrice, subtotal:quantity * unitPrice, availabilityAtOrder:'available', preorderQuantity:0 });

(async () => {
  let system, store;
  try {
    store = await H.startMockStore();
    system = await H.startSystem({ env:H.integrationEnv(store), name:'deposit-management-' });
    const add = order => { store.state.orders.set(order.orderNumber, order); return order; };
    const revision = async () => (await system.api('/api/live-revision', { username:'owner' })).body.revision;
    const setDefault = async (value, username = 'owner') => system.api('/api/settings/website-deposit', { username, method:'PUT', body:{ depositDefault:value, expectedRevision:await revision() } });
    const catalogDefault = async () => (await (await H.signedFetch(system.base, '/api/integration/v1/catalog')).json()).settings.websiteDepositDefault;

    // ---- Default deposit.
    assert.equal(await catalogDefault(), 100);
    assert.equal((await setDefault(175, 'cashier')).status, 403);
    let r = await setDefault(175);
    assert.equal(r.status, 200, r.text); assert.equal(r.body.previous, 100); assert.equal(r.body.depositDefault, 175);
    assert.equal(await catalogDefault(), 175);
    let db = system.readDb();
    assert.deepEqual([db.settings.websiteOrders.history[0].before, db.settings.websiteOrders.history[0].after, db.settings.websiteOrders.history[0].username], [100, 175, 'owner']);
    const audit = db.audit.find(row => row.operationType === 'WEBSITE_DEPOSIT_DEFAULT_CHANGED');
    assert.deepEqual([audit.before, audit.after, audit.username], [100, 175, 'owner']);
    assert.equal((await setDefault(150, 'manager')).status, 200);
    // A role granted order.deposit.default may change it.
    const whole = (await system.api('/api/db', { username:'owner' })).body;
    whole.settings.permissions = { roles:{ 'كاشير':{ actions:['order.deposit.default', 'order.website.view', 'order.website.approve', 'panel.view'] } }, users:{} };
    r = await system.api('/api/db', { username:'owner', method:'PUT', body:whole, headers:{ 'If-Match':await revision() } });
    assert.equal(r.status, 200, r.text);
    assert.equal((await setDefault(120, 'cashier')).status, 200);
    assert.deepEqual(system.readDb().settings.websiteOrders.history.slice(0, 3).map(row => [row.before, row.after]), [[150, 120], [175, 150], [100, 175]]);
    console.log('PASS default deposit: owner/manager or a granted role only, history with who/when/before/after, catalog reports it');

    // ---- New orders only: each Store order carries the default it was placed with.
    const oldOrder = add(H.storeOrder({ items:[item()], depositRequired:100 }));
    const newOrder = add(H.storeOrder({ customer:{ name:'جديد', mobile:'01001234599', altMobile:null }, items:[item()], depositRequired:120 }));
    assert.equal((await system.api(`/api/website-orders/${oldOrder.orderNumber}`, { username:'owner' })).body.depositRequired, 100);
    assert.equal((await system.api(`/api/website-orders/${newOrder.orderNumber}`, { username:'owner' })).body.depositRequired, 120);
    console.log('PASS a new default applies to new orders only; earlier orders keep their snapshot');

    // ---- One website order before approval (through the Store).
    const putWebsite = (number, body, username = 'owner') => system.api(`/api/website-orders/${number}/deposit`, { username, method:'PUT', body });
    assert.equal((await putWebsite(oldOrder.orderNumber, { amount:60, reason:'اتفاق' }, 'warehouse')).status, 403);
    r = await putWebsite(oldOrder.orderNumber, { amount:60 });
    assert.equal(r.status, 400); assert.equal(r.body.code, 'DEPOSIT_REASON_REQUIRED');
    r = await putWebsite(oldOrder.orderNumber, { amount:999, reason:'تجربة' });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'DEPOSIT_EXCEEDS_TOTAL');
    r = await putWebsite(oldOrder.orderNumber, { amount:60, reason:'اتفاق مع العميل' });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.previous, 100); assert.equal(r.body.depositRequired, 60);
    assert.equal(store.state.orders.get(oldOrder.orderNumber).depositRequired, 60);
    assert.equal(store.state.orders.get(newOrder.orderNumber).depositRequired, 120, 'other orders unchanged');
    assert.equal(store.state.orders.get(oldOrder.orderNumber).depositChanges[0].changedBy, 'owner');
    assert.equal((await system.api(`/api/website-orders/${oldOrder.orderNumber}`, { username:'owner' })).body.depositRequired, 60);
    assert.ok(system.readDb().audit.some(row => row.operationType === 'WEBSITE_ORDER_DEPOSIT_CHANGED' && row.before === 100 && row.after === 60));
    console.log('PASS one website order: permission, reason, capped at the total, other orders untouched, audited in both systems');

    // ---- Approve it (deposit received 60), then change the System order's required deposit.
    r = await system.api(`/api/website-orders/${oldOrder.orderNumber}/approve`, { username:'owner', method:'POST', body:{ deposit:H.deposit({ amount:60 }), shippingCompany:'البريد المصري' } });
    assert.equal(r.status, 201, r.text);
    const approved = r.body.order;
    assert.equal(approved.depositRequired, 60); assert.equal(approved.paidAmount, 60);
    assert.equal((await putWebsite(oldOrder.orderNumber, { amount:50, reason:'بعد الاعتماد' })).status, 409, 'after approval the System order is the record');
    db = system.readDb();
    const before = { payments:db.orderPayments.length, cash:db.cash.length, paid:db.onlineOrders.find(o => o.id === approved.id).paidAmount, remaining:db.onlineOrders.find(o => o.id === approved.id).remainingAmount, others:JSON.stringify(db.onlineOrders.filter(o => o.id !== approved.id)) };
    const patch = (id, body, username = 'owner') => system.api(`/api/orders/${id}/deposit-required`, { username, method:'PATCH', body });
    assert.equal((await patch(approved.id, { amount:150, reason:'اتفاق جديد' }, 'cashier')).status, 403);
    r = await patch(approved.id, { amount:1000, reason:'كبير' });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'DEPOSIT_EXCEEDS_TOTAL');
    r = await patch(approved.id, { amount:150, reason:'اتفاق جديد' });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.previous, 60);
    db = system.readDb();
    const changed = db.onlineOrders.find(o => o.id === approved.id);
    assert.equal(changed.depositRequired, 150); assert.equal(changed.deposit.required, 150);
    assert.deepEqual([changed.paidAmount, changed.remainingAmount], [before.paid, before.remaining], 'paid and remaining unchanged');
    assert.equal(db.orderPayments.length, before.payments); assert.equal(db.cash.length, before.cash, 'no payment or cash row');
    assert.equal(JSON.stringify(db.onlineOrders.filter(o => o.id !== approved.id)), before.others, 'other orders unchanged');
    assert.deepEqual([changed.depositHistory[0].before, changed.depositHistory[0].after, changed.depositHistory[0].username], [60, 150, 'owner']);
    assert.ok(db.audit.some(row => row.entityId === approved.id && /تعديل العربون المطلوب/.test(row.action)));
    console.log('PASS one System order: required deposit changes, paid/remaining/payments/cash do not, history and audit kept');

    // The Store link keeps required and received apart; a browser save cannot rewrite them.
    const links = (await (await H.signedFetch(system.base, '/api/integration/v1/website-orders/links')).json()).links;
    const link = links.find(row => row.salesOrderId === approved.id);
    assert.equal(link.depositRequired, 150); assert.equal(link.depositAmount, 60); assert.equal(link.paidAmount, 60);
    const tampered = (await system.api('/api/db', { username:'owner' })).body;
    Object.assign(tampered.onlineOrders.find(o => o.id === approved.id), { depositRequired:1, depositHistory:[] });
    r = await system.api('/api/db', { username:'owner', method:'PUT', body:tampered, headers:{ 'If-Match':await revision() } });
    assert.equal(r.status, 200, r.text);
    assert.equal(system.readDb().onlineOrders.find(o => o.id === approved.id).depositRequired, 150);
    assert.equal(system.readDb().onlineOrders.find(o => o.id === approved.id).depositHistory.length, 1);
    console.log('PASS the Store link sends depositRequired and depositAmount separately; whole-database saves keep them');

    // The Chatwood tab shows required, paid and remaining.
    r = await system.api(`/api/integration/v1/panel/customer?phone=01001234567`, { username:'owner' });
    const row = r.body.orders.find(entry => entry.salesOrderId === approved.id);
    assert.deepEqual([row.depositRequired, row.paid, row.remaining], [150, 60, approved.total - 60]);
    console.log('PASS the Chatwood tab shows the required deposit apart from paid and remaining');
    console.log('deposit management tests passed');
  } catch (error) {
    console.error(`FAIL ${error.stack || error.message}`);
    if (system) console.error(system.output().slice(-2000));
    process.exitCode = 1;
  } finally {
    system?.stop();
    await store?.close();
  }
})();
