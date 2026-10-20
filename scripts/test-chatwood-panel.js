'use strict';
// Chatwood panel endpoints: session + panel.view / panel.link, +20 phone normalization, one merged order list without
// duplicates, manual conversation linking through the Store, and degraded mode when the Store is unreachable.
const assert = require('node:assert/strict');
const H = require('./integration-test-helpers.js');

(async () => {
  const servers = [];
  let store;
  try {
    store = await H.startMockStore();
    const db = H.fixtureDb();
    db.customers = [
      { id:'C0001', name:'سارة', phone:'+20 100 123 4567', governorate:'القاهرة' },
      { id:'C0002', name:'عميل آخر', phone:'01119998887' }
    ];
    db.settings.permissions.roles['شحن'] = { views:['dashboard'], actions:['order.shipping'] }; // shipping: saved list without panel.view
    const line = (bookId, qty = 1) => ({ bookId, qty, price:100, finalNet:100 * qty });
    db.onlineOrders = [
      { id:'ORD-0001', customerId:'C0001', customerName:'سارة', phone:'01001234567', websiteOrderNumber:'MK261020-00001', websiteOrderId:1, source:'website', workflowStage:'shipped', status:'تم الشحن', total:235, paidAmount:100, remainingAmount:135, shipmentId:'SH-0001', saleId:'INV-0001', lines:[line('B0001', 2)], createdAt:'2026-10-11T10:00:00.000Z', updatedAt:'2026-10-11T10:00:00.000Z' },
      { id:'ORD-0002', customerId:'C0001', customerName:'سارة', phone:'01001234567', websiteOrderNumber:'MK261020-00003', websiteOrderId:3, source:'website', workflowStage:'awaiting_preparation', status:'قيد التجهيز', total:135, paidAmount:100, remainingAmount:35, chatwootConversationId:'900', lines:[line('B0001')], createdAt:'2026-10-12T10:00:00.000Z', updatedAt:'2026-10-12T10:00:00.000Z' },
      { id:'ORD-0003', customerId:'C0001', customerName:'سارة', phone:'01001234567', source:'whatsapp', workflowStage:'draft', status:'مسودة', total:100, paidAmount:0, lines:[line('B0002')], createdAt:'2026-10-13T10:00:00.000Z' },
      { id:'ORD-0004', customerId:'C0002', customerName:'عميل آخر', phone:'01119998887', workflowStage:'draft', status:'مسودة', total:50, lines:[line('B0002')], createdAt:'2026-10-13T10:00:00.000Z' }
    ];
    db.sales = [
      { id:'INV-0001', onlineOrderId:'ORD-0001', customerId:'C0001', status:'معتمدة', total:235, paid:100, remaining:135, lines:[line('B0001', 2)], createdAt:'2026-10-11T11:00:00.000Z' },
      { id:'INV-0002', customerId:'C0001', status:'معتمدة', total:300, paid:300, remaining:0, lines:[line('B0002', 3)], createdAt:'2026-09-01T10:00:00.000Z' },
      { id:'INV-0003', customerId:'C0001', status:'ملغاة', total:999, paid:0, remaining:999, lines:[line('B0001')], createdAt:'2026-09-02T10:00:00.000Z' }
    ];
    db.shipments = [{ id:'SH-0001', onlineOrderId:'ORD-0001', trackingNumber:'EG123456789EG', normalizedStatus:'out_for_delivery', company:'البريد المصري' }];
    const mk = (n, extra = {}) => H.storeOrder({ id:n, orderNumber:`MK261020-${String(n).padStart(5, '0')}`, ...extra });
    // 1: linked by the Store (salesOrderId); 2: still pending on the website; 3: approved in the System but the Store
    // never got the sales-link (salesOrderId null) — must still merge into ORD-0002; 4: another customer.
    for (const order of [mk(1, { status:'confirmed', salesOrderId:'ORD-0001' }), mk(2, { createdAt:'2026-10-14T10:00:00.000Z' }), mk(3, { status:'awaiting_confirmation', salesOrderId:null }), mk(4, { customer:{ name:'x', mobile:'01119998887', altMobile:null } })]) store.state.orders.set(order.orderNumber, order);
    const system = await H.startSystem({ db, env:H.integrationEnv(store), name:'chatwood-panel-' }); servers.push(system);
    const panel = (query, username = 'cashier') => system.api(`/api/integration/v1/panel/customer?${new URLSearchParams(query)}`, { username });

    // ---- Session and permission.
    assert.equal((await system.api('/api/integration/v1/panel/customer?phone=01001234567', { token:'' })).status, 401);
    assert.equal((await panel({ phone:'01001234567' }, 'shipping')).status, 403, 'a saved role list without panel.view is refused');
    for (const username of ['owner', 'manager', 'accountant', 'cashier', 'warehouse']) assert.equal((await panel({ phone:'01001234567' }, username)).status, 200, username);
    assert.equal((await panel({ phone:'12345' })).status, 400);
    assert.equal((await panel({ phone:'01001234567', conversationId:'abc' })).status, 400);
    console.log('PASS panel customer endpoint requires a session and panel.view');

    // ---- +20 normalization: every spelling reaches the same customer and the Store gets 01XXXXXXXXX.
    const results = [];
    for (const phone of ['+20 100 123 4567', '00201001234567', '201001234567', '1001234567', '٠١٠٠١٢٣٤٥٦٧', '01001234567']) {
      const r = await panel({ phone });
      assert.equal(r.status, 200, `${phone}: ${r.text}`);
      results.push(r.body);
    }
    assert.ok(results.every(result => result.customer.phone === '01001234567' && JSON.stringify(result.orders) === JSON.stringify(results[0].orders)));
    assert.ok(store.state.requests.filter(request => request.path === '/api/integration/v1/orders').every(request => request.query.phone === '01001234567' && request.query.state === 'all'));
    console.log('PASS panel normalizes +20 / 0020 / Arabic-digit phones');

    // ---- Merged, de-duplicated list and a minimal customer card.
    const body = (await panel({ phone:'+201001234567', conversationId:'900' })).body;
    assert.equal(body.storeAvailable, true);
    assert.deepEqual(body.customer, { name:'سارة', phone:'01001234567', known:true, customerIds:['C0001'], status:'returning', purchasesCount:2, purchasesTotal:535, paidTotal:400, outstanding:135, openOrders:2 });
    const numbers = body.orders.map(order => order.websiteOrderNumber).filter(Boolean);
    assert.deepEqual(numbers.slice().sort(), ['MK261020-00001', 'MK261020-00002', 'MK261020-00003'], 'each website order once');
    const o1 = body.orders.find(order => order.salesOrderId === 'ORD-0001');
    assert.equal(o1.websiteOrderNumber, 'MK261020-00001'); assert.equal(o1.storeOrderId, 1); assert.equal(o1.invoiceId, 'INV-0001');
    assert.equal(o1.shipment.status, 'out_for_delivery'); assert.equal(o1.trackingNumber, 'EG123456789EG'); assert.equal(o1.remaining, 135);
    assert.equal(o1.links.system, '/?view=onlineOrders&focus=order:ORD-0001'); assert.equal(o1.links.store, 'https://store.maktabaa.com/admin/orders/1');
    assert.deepEqual(o1.products, [{ name:'كتاب B0001', qty:2 }]);
    const o3 = body.orders.find(order => order.websiteOrderNumber === 'MK261020-00003');
    assert.equal(o3.salesOrderId, 'ORD-0002', 'merged by the System websiteOrderNumber even without the Store link'); assert.equal(o3.linkedToConversation, true);
    const pending = body.orders.find(order => order.websiteOrderNumber === 'MK261020-00002');
    assert.equal(pending.kind, 'website_order'); assert.equal(pending.awaitingApproval, true); assert.equal(pending.links.system, '');
    assert.ok(body.orders.some(order => order.kind === 'sale' && order.invoiceId === 'INV-0002'), 'POS sales of the customer are listed');
    assert.ok(body.orders.some(order => order.salesOrderId === 'ORD-0003'), 'System-only orders are listed');
    assert.ok(!body.orders.some(order => order.invoiceId === 'INV-0001' && order.kind === 'sale'), 'an invoice of a listed order is not repeated');
    const text = JSON.stringify(body);
    assert.ok(!text.includes('01119998887') && !text.includes('MK261020-00004') && !text.includes('ORD-0004'), 'no other customer data');
    assert.ok(!/passwordHash|"users"|"books"|"cost"/.test(text), 'never the database');
    assert.deepEqual(Object.keys(body).sort(), ['conversationId', 'customer', 'ok', 'orders', 'storeAvailable']);
    const fresh = (await panel({ phone:'01555555555' })).body;
    assert.equal(fresh.customer.status, 'new'); assert.equal(fresh.customer.known, false); assert.deepEqual(fresh.orders, []);
    console.log('PASS panel merges Store and System orders without duplicates and returns only a minimal summary');

    // ---- Manual conversation link (panel.link) through the Store; mirrored on the System order.
    const link = (payload, username = 'cashier') => system.api('/api/integration/v1/panel/link-conversation', { username, method:'POST', body:payload });
    assert.equal((await system.api('/api/integration/v1/panel/link-conversation', { token:'', method:'POST', body:{} })).status, 401);
    assert.equal((await link({ orderNumber:'MK261020-00001', conversationId:'901', contactPhone:'+201001234567' }, 'warehouse')).status, 403, 'panel.link is owner/manager/cashier');
    assert.equal((await link({ conversationId:'901', contactPhone:'01001234567' })).body.code, 'INVALID_ORDER_NUMBER', 'never picks an order automatically');
    assert.equal((await link({ orderNumber:'MK261020-00001', conversationId:'x1', contactPhone:'01001234567' })).body.code, 'INVALID_CONVERSATION');
    let r = await link({ orderNumber:'MK261020-00001', conversationId:'901', contactPhone:'01119998887' });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'PHONE_MISMATCH');
    r = await link({ orderNumber:'MK261020-00001', conversationId:'901', contactPhone:'+20 100 123 4567' });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.systemOrderId, 'ORD-0001'); assert.equal(r.body.systemUpdated, true);
    assert.equal(store.state.orders.get('MK261020-00001').chatwootConversationId, '901');
    const linkRequest = store.state.requests.filter(request => request.path.endsWith('/conversation')).at(-1);
    assert.deepEqual(linkRequest.body, { conversationId:'901', contactPhone:'01001234567', linkedBy:'cashier' }); assert.equal(linkRequest.verified, true);
    assert.equal(system.readDb().onlineOrders.find(order => order.id === 'ORD-0001').chatwootConversationId, '901');
    r = await link({ orderNumber:'MK261020-00001', conversationId:'902', contactPhone:'01001234567' });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'CONVERSATION_ALREADY_LINKED');
    // The System order already has another conversation: the Store link is passed through but the System one is kept.
    r = await link({ orderNumber:'MK261020-00003', conversationId:'903', contactPhone:'01001234567' });
    assert.equal(r.status, 200); assert.equal(r.body.systemConflict, true); assert.equal(r.body.systemUpdated, false);
    assert.equal(system.readDb().onlineOrders.find(order => order.id === 'ORD-0002').chatwootConversationId, '900');
    r = await link({ orderNumber:'MK261020-00002', conversationId:'904', contactPhone:'01001234567' });
    assert.equal(r.status, 200); assert.equal(r.body.systemOrderId, null, 'a website order not yet in the System is linked on the Store only');
    console.log('PASS manual link goes through the Store (phone check, no overwrite) and is mirrored on the System order');

    // ---- Store unavailable: the panel still shows System orders; approval and links fail explicitly.
    store.state.down = true;
    r = await panel({ phone:'01001234567' });
    assert.equal(r.status, 200); assert.equal(r.body.storeAvailable, false);
    assert.ok(r.body.orders.length >= 3 && r.body.orders.every(order => order.kind !== 'website_order'));
    assert.equal((await link({ orderNumber:'MK261020-00002', conversationId:'905', contactPhone:'01001234567' })).status, 502);
    store.state.down = false;
    const unreachable = await H.startSystem({ db:H.fixtureDb(), env:H.integrationEnv({ base:`http://127.0.0.1:${await H.freePort()}` }), name:'chatwood-unreachable-' }); servers.push(unreachable);
    r = await unreachable.api('/api/website-orders/MK261020-00001/approve', { username:'cashier', method:'POST', body:{ deposit:H.deposit() } });
    assert.equal(r.status, 502); assert.equal(r.body.code, 'STORE_UNAVAILABLE');
    assert.equal(unreachable.readDb().meta.dataRevision, 0, 'nothing written');
    assert.equal((await unreachable.api('/api/integration/v1/panel/customer?phone=01001234567', { username:'cashier' })).body.storeAvailable, false);
    console.log('PASS unreachable Store: panel degrades to System data, approval returns 502 without writing');
    console.log('PASS chatwood panel checks completed');
  } finally {
    for (const server of servers) server.stop();
    if (store) await store.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
