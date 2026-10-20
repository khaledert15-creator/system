'use strict';
// Who an order belongs to: quick orders keep the Chatwood conversation, contact and WhatsApp owner apart from the
// recipient's delivery phone; the tab shows owners their orders and recipients only status; older orders are linked
// only through the signed, evidence-based history endpoint; nothing here changes phones or customers.
const assert = require('node:assert/strict');
const H = require('./integration-test-helpers.js');

const line = (qty = 1, price = 100) => [{ bookId:'B0001', qty, price, lineTotal:qty * price }];

(async () => {
  let system, store;
  try {
    store = await H.startMockStore();
    const db = H.fixtureDb();
    db.customers = [{ id:'C-L', name:'عميل قديم', phone:'01033330003' }];
    db.onlineOrders = [{ id:'ORD-L1', date:'2026-10-16', customerId:'C-L', customerName:'عميل قديم', phone:'01033330003', alternativePhone:'', source:'whatsapp', status:'تم الشحن', workflowStage:'shipped', lines:line(), total:135, paidAmount:0, chatwootConversationId:'', confirmedAt:'2026-10-16T10:00:00.000Z', createdAt:'2026-10-16T10:00:00.000Z', deletedAt:null }];
    system = await H.startSystem({ db, env:H.integrationEnv(store), name:'chatwood-ownership-' });
    const panel = query => system.api(`/api/integration/v1/panel/customer?${new URLSearchParams(query)}`, { username:'owner' });
    const create = body => system.api('/api/orders/quick', { username:'owner', method:'POST', body:{ customerName:'مستلم الهدية', governorate:'القاهرة', city:'مدينة نصر', address:'شارع المستلم 5', shippingCost:35, lines:[{ bookId:'B0001', qty:1 }], ...body } });
    const ids = list => list.map(row => row.salesOrderId).sort();

    // ---- A buyer (WhatsApp 01011110001, contact 9001, conversation 8001) orders a gift for a recipient (01022220002).
    let r = await create({ requestId:'own-1', phone:'01022220002', customerWhatsAppPhone:'+20 101 111 0001', chatwootConversationId:'8001', chatwootContactId:'9001' });
    assert.equal(r.status, 201, r.text);
    const gift = r.body.order;
    assert.deepEqual([gift.phone, gift.customerWhatsAppPhone, gift.chatwootConversationId, gift.chatwootContactId], ['01022220002', '01011110001', '8001', '9001']);
    r = await create({ requestId:'own-bad', phone:'01022220002', customerWhatsAppPhone:'123', chatwootConversationId:'abc', chatwootContactId:'x1' });
    assert.equal(r.status, 201); assert.deepEqual([r.body.order.customerWhatsAppPhone, r.body.order.chatwootConversationId, r.body.order.chatwootContactId], ['', '', ''], 'malformed identity is not stored');
    const malformed = r.body.order.id;
    console.log('PASS quick order keeps conversation, contact and WhatsApp owner apart from the recipient phone');

    // ---- The buyer sees the order (by contact even without a phone, by WhatsApp number, by conversation).
    r = await panel({ contactId:'9001' });
    assert.equal(r.status, 200, r.text); assert.deepEqual(ids(r.body.orders), [gift.id]); assert.equal(r.body.orders[0].matchedBy, 'contact');
    r = await panel({ phone:'01011110001' });
    assert.deepEqual(ids(r.body.orders), [gift.id]); assert.equal(r.body.orders[0].matchedBy, 'whatsapp');
    r = await panel({ conversationId:'8001' });
    assert.deepEqual(ids(r.body.orders), [gift.id]); assert.equal(r.body.orders[0].matchedBy, 'conversation');
    console.log('PASS the owner finds the order by contact, WhatsApp number or conversation');

    // ---- The recipient chatting from the delivery phone (another contact) sees status only, not as their order.
    r = await panel({ phone:'01022220002', contactId:'9002' });
    assert.ok(!ids(r.body.orders).includes(gift.id), 'not listed as the recipient\'s own order');
    assert.deepEqual(r.body.recipientOrders.map(row => row.salesOrderId), [gift.id]);
    assert.deepEqual(Object.keys(r.body.recipientOrders[0]).sort(), ['createdAt', 'links', 'phase', 'phaseLabel', 'salesOrderId', 'shipment', 'trackingNumber', 'websiteOrderNumber']);
    assert.ok(ids(r.body.orders).includes(malformed), 'an order with no recorded owner still matches by phone');
    assert.equal(r.body.customer.purchasesCount, 0);
    console.log('PASS the recipient sees only the order number, status and tracking of another customer\'s order');

    // ---- Similar numbers never match.
    for (const near of ['01011110002', '01011110011', '0101111000']) {
      r = await panel({ phone:near });
      if (r.status === 400) { assert.equal(r.body.code, 'INVALID_PHONE'); continue; }
      assert.ok(![...ids(r.body.orders), ...r.body.recipientOrders.map(row => row.salesOrderId)].includes(gift.id), `no match for ${near}`);
    }
    console.log('PASS similar phone numbers show nothing');

    // ---- An older order without an owner keeps matching by phone; one conversation can have several orders.
    r = await panel({ phone:'01033330003' });
    assert.deepEqual(ids(r.body.orders), ['ORD-L1']); assert.equal(r.body.orders[0].matchedBy, 'phone');
    r = await create({ requestId:'own-2', phone:'01011110001', customerWhatsAppPhone:'01011110001', chatwootConversationId:'8001', chatwootContactId:'9001' });
    assert.equal(r.status, 201);
    r = await panel({ contactId:'9001' });
    assert.equal(r.body.orders.length, 2);
    console.log('PASS older orders still match by phone and one conversation can hold several orders');

    // ---- Editing fills a missing identity and never replaces a different one; a browser save cannot change it.
    r = await system.api(`/api/orders/${malformed}/quick`, { username:'owner', method:'PATCH', body:{ phone:'01022220002', customerName:'مستلم الهدية', governorate:'القاهرة', city:'مدينة نصر', address:'شارع المستلم 5', shippingCost:35, lines:[{ bookId:'B0001', qty:1 }], chatwootContactId:'9003', customerWhatsAppPhone:'01044440004' } });
    assert.equal(r.status, 200, r.text);
    let order = system.readDb().onlineOrders.find(row => row.id === malformed);
    assert.deepEqual([order.chatwootContactId, order.customerWhatsAppPhone], ['9003', '01044440004']);
    r = await system.api(`/api/orders/${gift.id}/quick`, { username:'owner', method:'PATCH', body:{ phone:'01022220002', customerName:'مستلم الهدية', governorate:'القاهرة', city:'مدينة نصر', address:'شارع المستلم 5', shippingCost:35, lines:[{ bookId:'B0001', qty:1 }], chatwootContactId:'9999' } });
    assert.equal(system.readDb().onlineOrders.find(row => row.id === gift.id).chatwootContactId, '9001', 'a different contact is not written over');
    const revision = (await system.api('/api/live-revision', { username:'owner' })).body.revision;
    const whole = (await system.api('/api/db', { username:'owner' })).body;
    Object.assign(whole.onlineOrders.find(row => row.id === gift.id), { chatwootContactId:'1', customerWhatsAppPhone:'01000000000', chatwootConversationId:'2' });
    r = await system.api('/api/db', { username:'owner', method:'PUT', body:whole, headers:{ 'If-Match':revision } });
    assert.equal(r.status, 200, r.text);
    order = system.readDb().onlineOrders.find(row => row.id === gift.id);
    assert.deepEqual([order.chatwootContactId, order.customerWhatsAppPhone, order.chatwootConversationId], ['9001', '01011110001', '8001']);
    console.log('PASS edits fill a missing identity only; whole-database saves keep it');

    // ---- History links: signed only, dry run first, only orders without an owner, phones and customers unchanged.
    const before = system.readDb();
    const links = [{ orderId:'ORD-L1', conversationId:'7001', contactId:'6001', evidence:['phone_in_message'] }, { orderId:gift.id, conversationId:'7002', contactId:'6002' }, { orderId:'ORD-NOPE', conversationId:'1', contactId:'1' }];
    const raw = JSON.stringify({ links, approvedBy:'owner-approval-test' });
    assert.equal((await fetch(`${system.base}/api/integration/v1/orders/chatwood-links`, { method:'POST', body:raw })).status, 401);
    r = await (await H.signedFetch(system.base, '/api/integration/v1/orders/chatwood-links', { method:'POST', body:raw })).json();
    assert.equal(r.dryRun, true); assert.equal(r.linked, 1);
    assert.deepEqual(r.skipped.map(row => row.reason).sort(), ['ORDER_NOT_FOUND', 'OWNER_ALREADY_RECORDED']);
    assert.equal(system.readDb().onlineOrders.find(row => row.id === 'ORD-L1').chatwootContactId, undefined, 'a dry run writes nothing');
    r = await (await H.signedFetch(system.base, '/api/integration/v1/orders/chatwood-links', { method:'POST', body:JSON.stringify({ links, approvedBy:'owner-approval-test', dryRun:false }) })).json();
    assert.equal(r.linked, 1);
    const after = system.readDb(), linked = after.onlineOrders.find(row => row.id === 'ORD-L1'), was = before.onlineOrders.find(row => row.id === 'ORD-L1');
    assert.deepEqual([linked.chatwootConversationId, linked.chatwootContactId, linked.chatwoodLink.source, linked.chatwoodLink.evidence[0]], ['7001', '6001', 'history-review', 'phone_in_message']);
    assert.deepEqual([linked.phone, linked.customerId, linked.alternativePhone], [was.phone, was.customerId, was.alternativePhone]);
    assert.equal(JSON.stringify(after.customers), JSON.stringify(before.customers));
    assert.ok(after.audit.some(row => row.operationType === 'ORDER_CHATWOOD_LINKED' && row.entityId === 'ORD-L1'));
    r = await panel({ contactId:'6001' });
    assert.deepEqual(ids(r.body.orders), ['ORD-L1']);
    console.log('PASS history links are signed, dry-run first, never override an owner, and change no phone or customer');
    console.log('chatwood ownership tests passed');
  } catch (error) {
    console.error(`FAIL ${error.stack || error.message}`);
    if (system) console.error(system.output().slice(-2000));
    process.exitCode = 1;
  } finally {
    system?.stop();
    await store?.close();
  }
})();
