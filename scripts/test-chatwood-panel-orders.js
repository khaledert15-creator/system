'use strict';
// Chatwood «طلبات العميل»: every order of the customer (old, new, confirmed, shipped, cancelled, without a conversation
// id), merged without duplicates, grouped, and never another customer's orders. Isolated System + mock Store.
const assert = require('node:assert/strict');
const H = require('./integration-test-helpers.js');

const line = (qty = 1, price = 100) => [{ bookId:'B0001', qty, price, lineTotal:qty * price }];
const order = (id, customerId, phone, extra = {}) => ({ id, date:'2026-09-01', customerId, customerName:`عميل ${customerId}`, phone, alternativePhone:'', source:'whatsapp', status:'قيد التجهيز', workflowStage:'awaiting_preparation', lines:line(), total:135, shippingFee:35, paidAmount:0, chatwootConversationId:'', confirmedAt:'2026-09-01T10:00:00.000Z', createdAt:'2026-09-01T10:00:00.000Z', updatedAt:'2026-09-01T10:00:00.000Z', deletedAt:null, ...extra });

(async () => {
  let system, store;
  try {
    store = await H.startMockStore();
    const db = H.fixtureDb();
    db.settings.permissions.users = { accountant:{ actions:[] } };
    db.customers = [
      { id:'C-A', name:'عميل أ', phone:'201011110001' },           // stored with the 20 prefix
      { id:'C-C', name:'عميل ج', phone:'01033330003' },
      { id:'C-D', name:'عميل د', phone:'01044440004' },
      { id:'C-E', name:'عميل هـ', phone:'01055550005' },
      { id:'C-F', name:'عميل بدون طلبات', phone:'01066660006' },
      { id:'C-G', name:'عميل ز', phone:'01077770007' },
      { id:'C-H', name:'مستلم آخر', phone:'01088880008' }
    ];
    db.onlineOrders = [
      // Case 1/4/7/8: three old WhatsApp orders, no conversation id, delivered / shipped / preparing.
      order('ORD-A1', 'C-A', '01011110001', { status:'تم التسليم', workflowStage:'delivered', saleId:'INV-A1', shipmentId:'SH-A1', paidAmount:135, createdAt:'2026-08-01T10:00:00.000Z' }),
      order('ORD-A2', 'C-A', '+20 101 111 0001', { status:'تم الشحن', workflowStage:'shipped', saleId:'INV-A2', shipmentId:'SH-A2', createdAt:'2026-08-15T10:00:00.000Z' }),
      order('ORD-A3', 'C-A', '01011110001', { createdAt:'2026-09-10T10:00:00.000Z', depositRequired:100, paidAmount:100 }),
      // Case 3: website order already approved into a System order.
      order('ORD-C1', 'C-C', '01033330003', { source:'website', websiteOrderNumber:'MK261020-30001', depositRequired:100, paidAmount:100 }),
      // Case 5: cancelled + delivered.
      order('ORD-D1', 'C-D', '01044440004', { status:'ملغي', workflowStage:'cancelled', cancelledAt:'2026-09-02T10:00:00.000Z' }),
      order('ORD-D2', 'C-D', '01044440004', { status:'تم التسليم', workflowStage:'delivered' }),
      // Case 6: one customer, two conversations, plus an order with none.
      order('ORD-E1', 'C-E', '01055550005', { chatwootConversationId:'501' }),
      order('ORD-E2', 'C-E', '01055550005', { chatwootConversationId:'502', workflowStage:'awaiting_stock', status:'حجز مسبق' }),
      order('ORD-E3', 'C-E', '01055550005'),
      // Case 10: two orders in the same state.
      order('ORD-G1', 'C-G', '01077770007'), order('ORD-G2', 'C-G', '01077770007'),
      // Saved under the recipient's phone but linked to conversation 777.
      order('ORD-H1', 'C-H', '01088880008', { chatwootConversationId:'777' }),
      // Customer A's invoice for an order saved under another phone.
      order('ORD-A4', 'C-H', '01088880008', { saleId:'INV-A4', status:'تم التسليم', workflowStage:'delivered' })
    ];
    db.sales = [
      { id:'INV-A1', customerId:'C-A', onlineOrderId:'ORD-A1', total:135, paid:135, remaining:0, status:'مدفوعة', lines:line() },
      { id:'INV-A2', customerId:'C-A', onlineOrderId:'ORD-A2', total:135, paid:0, remaining:135, status:'آجلة', lines:line() },
      { id:'INV-A4', customerId:'C-A', onlineOrderId:'ORD-A4', total:135, paid:135, remaining:0, status:'مدفوعة', lines:line() }
    ];
    db.shipments = [
      { id:'SH-A1', onlineOrderId:'ORD-A1', trackingNumber:'EGA1000001EG', shippingStatus:'delivered', normalizedStatus:'delivered', company:'البريد المصري' },
      { id:'SH-A2', onlineOrderId:'ORD-A2', trackingNumber:'EGA2000002EG', shippingStatus:'in_transit', normalizedStatus:'in_transit', company:'البريد المصري' }
    ];
    system = await H.startSystem({ db, env:H.integrationEnv(store), name:'panel-orders-' });
    const add = row => { store.state.orders.set(row.orderNumber, row); return row; };
    // Case 2: a pending website order (Store only). Case 3: the Store side of ORD-C1.
    add(H.storeOrder({ orderNumber:'MK261020-20001', customer:{ name:'عميل ب', mobile:'01022220002', altMobile:null }, depositRequired:150, items:[{ productId:1, externalBookId:'B0001', nameAr:'كتاب', quantity:2, unitPrice:100, subtotal:200 }] }));
    add(H.storeOrder({ orderNumber:'MK261020-30001', customer:{ name:'عميل ج', mobile:'01033330003', altMobile:null }, status:'confirmed', salesOrderId:'ORD-C1' }));
    add(H.storeOrder({ orderNumber:'MK261020-70001', customer:{ name:'مستلم', mobile:'01099990099', altMobile:null }, chatwootConversationId:'777' }));
    const panel = (query, username = 'owner') => system.api(`/api/integration/v1/panel/customer?${new URLSearchParams(query)}`, { username });
    const ids = body => body.orders.map(row => row.salesOrderId || row.websiteOrderNumber || row.invoiceId).sort();

    let r = await panel({ phone:'+201011110001' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(ids(r.body), ['ORD-A1', 'ORD-A2', 'ORD-A3', 'ORD-A4']);
    assert.deepEqual(Object.fromEntries(r.body.orders.map(row => [row.salesOrderId, row.phase])), { 'ORD-A1':'delivered', 'ORD-A2':'shipped', 'ORD-A3':'preparing', 'ORD-A4':'delivered' });
    assert.equal(r.body.orders.find(row => row.salesOrderId === 'ORD-A2').trackingNumber, 'EGA2000002EG');
    assert.equal(r.body.orders.find(row => row.salesOrderId === 'ORD-A4').matchedBy, 'invoice');
    assert.equal(r.body.orders.find(row => row.salesOrderId === 'ORD-A3').depositRequired, 100);
    assert.equal(r.body.customer.ordersCount, 4); assert.equal(r.body.customer.purchasesCount, 3); assert.equal(r.body.customer.status, 'returning');
    assert.equal((await panel({ phone:'01011110001' })).body.orders.length, 4, '01… and +201… give the same customer');
    console.log('PASS 1/4/7/8: three old WhatsApp orders without conversation ids, delivered/shipped/preparing, +20 and 01 formats, invoice under another phone');

    r = await panel({ phone:'01022220002' });
    assert.deepEqual(ids(r.body), ['MK261020-20001']);
    assert.equal(r.body.orders[0].phase, 'awaiting_confirmation'); assert.equal(r.body.orders[0].depositRequired, 150); assert.equal(r.body.customer.known, false); assert.equal(r.body.customer.identified, true);
    console.log('PASS 2: unconfirmed website order with its required deposit');

    r = await panel({ phone:'01033330003' });
    assert.deepEqual(ids(r.body), ['ORD-C1']);
    assert.equal(r.body.orders[0].websiteOrderNumber, 'MK261020-30001'); assert.equal(r.body.orders[0].source, 'website');
    console.log('PASS 3: website order confirmed into the System appears once with both numbers');

    r = await panel({ phone:'01044440004' });
    assert.deepEqual(r.body.orders.map(row => row.phase).sort(), ['cancelled', 'delivered']);
    assert.ok(r.body.orders.every(row => row.group === 'history'));
    console.log('PASS 5: cancelled and delivered orders are in the history');

    r = await panel({ phone:'01055550005', conversationId:'501' });
    assert.deepEqual(ids(r.body), ['ORD-E1', 'ORD-E2', 'ORD-E3']);
    assert.deepEqual(r.body.orders.filter(row => row.linkedToConversation).map(row => row.salesOrderId), ['ORD-E1']);
    assert.equal(r.body.orders.find(row => row.salesOrderId === 'ORD-E2').phase, 'preorder');
    console.log('PASS 6: several conversations — every order shows, only the open conversation is marked linked');

    r = await panel({ phone:'01099990009' });
    assert.equal(r.status, 200); assert.equal(r.body.orders.length, 0); assert.equal(r.body.customer.identified, false);
    r = await panel({ phone:'01066660006' });
    assert.equal(r.body.orders.length, 0); assert.equal(r.body.customer.identified, true); assert.equal(r.body.customer.known, true);
    console.log('PASS 9: unknown number and known customer without orders are told apart');

    r = await panel({ phone:'01077770007' });
    assert.equal(r.body.counts.preparing, 2); assert.equal(r.body.orders.length, 2);
    console.log('PASS 10: two orders in the same state');

    assert.equal((await panel({ phone:'01011110001' }, 'accountant')).status, 403);
    assert.equal((await system.api('/api/integration/v1/panel/customer?phone=01011110001', { token:'' })).status, 401);
    r = await panel({ phone:'01011110001' });
    assert.ok(!ids(r.body).some(id => /ORD-(C|D|E|G|H1)/.test(id) || /MK261020-(2|7)/.test(id)), 'no other customer');
    console.log('PASS 11: no permission → 403, no session → 401, and one customer never sees another\'s orders');

    // Conversation-only matches: the recipient's phone differs, the conversation is the link.
    r = await panel({ phone:'01011110001', conversationId:'777' });
    assert.ok(ids(r.body).includes('ORD-H1') && ids(r.body).includes('MK261020-70001'));
    assert.equal(r.body.orders.find(row => row.salesOrderId === 'ORD-H1').matchedBy, 'conversation');
    r = await panel({ phone:'+966500000000', conversationId:'777' });
    assert.equal(r.status, 200, r.text); assert.deepEqual(ids(r.body), ['MK261020-70001', 'ORD-H1']); assert.equal(r.body.phoneUsable, false);
    r = await panel({ phone:'+966500000000' });
    assert.equal(r.status, 400); assert.equal(r.body.code, 'INVALID_PHONE');
    assert.equal((await panel({})).body.code, 'CUSTOMER_NOT_IDENTIFIED');
    console.log('PASS orders linked to the open conversation show even under another phone; a contact without a usable phone is found by conversation');

    store.state.down = true;
    r = await panel({ phone:'01022220002' });
    assert.equal(r.status, 200); assert.equal(r.body.storeAvailable, false); assert.equal(r.body.storeEnabled, true); assert.equal(r.body.orders.length, 0);
    r = await panel({ phone:'01011110001' });
    assert.equal(r.body.orders.length, 4, 'System orders still show while the Store is down');
    store.state.down = false;
    r = await panel({ phone:'01022220002' });
    assert.equal(r.body.storeAvailable, true); assert.deepEqual(ids(r.body), ['MK261020-20001']);
    console.log('PASS 12: Store failure is reported (not «no orders»), System orders stay, retry brings the website order back');

    assert.ok(!/0101111|0102222|0105555/.test(system.output()), 'phones are not written to the server log');
    console.log('PASS phones are not logged');
    console.log('chatwood panel orders tests passed');
  } catch (error) {
    console.error(`FAIL ${error.stack || error.message}`);
    if (system) console.error(system.output().slice(-2000));
    process.exitCode = 1;
  } finally {
    system?.stop();
    await store?.close();
  }
})();
