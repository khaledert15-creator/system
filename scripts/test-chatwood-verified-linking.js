'use strict';
// Phase 2 Chatwood linking: a quick order takes its owner only from a context the server verified with the Store;
// staff mentions of an order number are suggestions an employee confirms; owner/manager correct links with an audit
// trail; none of it touches stock, invoices, payments or customers.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const H = require('./integration-test-helpers.js');
const ChatwoodContext = require('../app/chatwood-context.js');

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const money = db => hash({ books:db.books, sales:db.sales, orderPayments:db.orderPayments, cash:db.cash, customers:db.customers, inventoryBatches:db.inventoryBatches, stockMovements:db.stockMovements });
const orderCore = order => { const { chatwootConversationId, chatwootContactId, customerWhatsAppPhone, chatwoodLink, chatwoodLinkHistory, updatedAt, ...rest } = order; return hash(rest); };

(async () => {
  let system, store;
  try {
    store = await H.startMockStore();
    store.state.conversations.set('8001', H.chatwoodConversation('8001'));
    store.state.conversations.set('8002', H.chatwoodConversation('8002', { contactId:'9002', contactPhone:'01033330003', mentions:[{ orderRef:'ORD-L1', mentionedAt:'2026-10-20T10:00:00.000Z', messages:1 }] }));
    store.state.conversations.set('8003', H.chatwoodConversation('8003', { contactId:'9003', contactPhone:null, mentions:[{ orderRef:'ORD-L1', mentionedAt:'2026-10-20T11:00:00.000Z', messages:1 }] }));
    store.state.conversations.set('8004', H.chatwoodConversation('8004', { contactId:'9002', contactPhone:'01033330003' }));
    store.state.conversations.set('8100', H.chatwoodConversation('8100', { channel:'Channel::Api' }));
    const db = H.fixtureDb();
    db.customers = [{ id:'C-L', name:'عميل قديم', phone:'01033330003' }];
    db.onlineOrders = [{ id:'ORD-L1', date:'2026-10-16', customerId:'C-L', customerName:'عميل قديم', phone:'01033330003', alternativePhone:'', source:'whatsapp', status:'تم الشحن', workflowStage:'shipped', lines:[{ bookId:'B0001', qty:1, price:100, lineTotal:100 }], total:135, paidAmount:0, confirmedAt:'2026-10-16T10:00:00.000Z', createdAt:'2026-10-16T10:00:00.000Z', deletedAt:null }];
    system = await H.startSystem({ db, env:H.integrationEnv(store), name:'chatwood-verified-' });
    const panel = (query, username = 'owner') => system.api(`/api/integration/v1/panel/customer?${new URLSearchParams(query)}`, { username });
    const create = (body, username = 'owner') => system.api('/api/orders/quick', { username, method:'POST', body:{ duplicateOverrideReason:'اختبار طلبات متعددة لنفس العميل', customerName:'مستلم', governorate:'القاهرة', city:'مدينة نصر', address:'شارع الاختبار 5', shippingCost:35, lines:[{ bookId:'B0001', qty:1 }], requestId:crypto.randomUUID(), ...body } });
    const link = (id, body, username = 'owner') => system.api(`/api/orders/${id}/chatwood-link`, { username, method:'POST', body });
    const correct = (id, body, username = 'owner') => system.api(`/api/orders/${id}/chatwood-link/correct`, { username, method:'POST', body });
    const order = id => system.readDb().onlineOrders.find(row => row.id === id);
    const audits = (id, type) => system.readDb().audit.filter(row => row.entityId === id && row.operationType === type);

    // ---- 1 + 4. From a verified conversation: the order is linked automatically; the recipient phone stays apart.
    let r = await panel({ conversationId:'8001', contactId:'9001' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.conversationVerified, true); assert.equal(r.body.orderContext.ok, true); assert.equal(r.body.orderContext.whatsappMasked, '0101****001');
    const token = r.body.orderContext.token;
    r = await system.api('/api/chatwood-context/resolve', { method:'POST', body:{ token } });
    assert.deepEqual([r.body.context.conversationId, r.body.context.contactId, r.body.context.customerWhatsAppPhone], ['8001', '9001', '01011110001']);
    r = await create({ phone:'01022220002', chatwoodContext:token });
    assert.equal(r.status, 201, r.text);
    const first = r.body.order;
    assert.deepEqual([first.phone, first.customerWhatsAppPhone, first.chatwootConversationId, first.chatwootContactId, first.chatwoodLink.source], ['01022220002', '01011110001', '8001', '9001', 'verified-context']);
    console.log('PASS 1+4 an order made from a verified conversation is linked; the WhatsApp owner and the recipient stay apart');

    // ---- 2. After confirming, the next order from the same context is linked too.
    r = await system.api(`/api/orders/${first.id}/confirm`, { method:'POST', body:{} });
    assert.ok([200, 201].includes(r.status), r.text);
    r = await create({ phone:'01011110001', chatwoodContext:token });
    assert.equal(r.status, 201, r.text);
    const second = r.body.order;
    assert.deepEqual([second.chatwootConversationId, second.chatwootContactId, second.customerWhatsAppPhone], ['8001', '9001', '01011110001']);
    r = await panel({ conversationId:'8001', contactId:'9001' });
    assert.deepEqual(r.body.orders.map(row => row.salesOrderId).sort(), [first.id, second.id].sort());
    console.log('PASS 2 the context carries to the next order of the same conversation after confirmation');

    // ---- 3. An independent order: created normally, no owner; ids sent by the browser are ignored.
    r = await create({ phone:'01044440004', chatwootConversationId:'8001', chatwootContactId:'9001', customerWhatsAppPhone:'01011110001' });
    assert.equal(r.status, 201, r.text);
    const independent = r.body.order;
    assert.deepEqual([independent.chatwootConversationId, independent.chatwootContactId, independent.customerWhatsAppPhone, independent.chatwoodLink], ['', '', '', undefined]);
    console.log('PASS 3 an order without a context is created unlinked, and raw ids from the browser are ignored');

    // ---- 7. Invalid or unauthorized context and conversation ids are refused.
    const [body] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), c:'8003' })).toString('base64url')}.${token.split('.')[1]}`;
    assert.equal((await create({ phone:'01044440004', chatwoodContext:forged })).body.code, 'CHATWOOD_CONTEXT_INVALID');
    assert.equal((await create({ phone:'01044440004', chatwoodContext:token }, 'cashier')).body.code, 'CHATWOOD_CONTEXT_OTHER_USER');
    const expired = ChatwoodContext.issueContextToken(H.SECRET, { conversationId:'8001', contactId:'9001', username:'owner' }, Date.now() - ChatwoodContext.CONTEXT_TTL_MS - 1000).token;
    r = await create({ phone:'01044440004', chatwoodContext:expired });
    assert.deepEqual([r.status, r.body.code], [409, 'CHATWOOD_CONTEXT_EXPIRED']);
    assert.equal((await system.api('/api/chatwood-context/resolve', { method:'POST', body:{ token:expired } })).body.code, 'CHATWOOD_CONTEXT_EXPIRED');
    assert.equal((await panel({ conversationId:'8999' })).body.orderContext.code, 'CONVERSATION_NOT_FOUND');
    assert.equal((await panel({ conversationId:'8100' })).body.orderContext.code, 'CONVERSATION_NOT_WHATSAPP');
    r = await panel({ conversationId:'8001', contactId:'1234' });
    assert.deepEqual([r.body.orderContext.ok, r.body.orderContext.code, r.body.conversationVerified], [false, 'CONTACT_MISMATCH', false]);
    assert.equal((await system.api(`/api/orders/${independent.id}/chatwood-link/preview?conversationId=abc`)).status, 400);
    assert.equal((await system.api(`/api/orders/${independent.id}/chatwood-link/preview?conversationId=8999`)).body.code, 'CONVERSATION_NOT_FOUND');
    assert.equal((await link(independent.id, { conversationId:'8001' })).body.code, 'CONTACT_REQUIRED');
    assert.equal((await link(independent.id, { conversationId:'8001', contactId:'9999' })).body.code, 'CONTACT_MISMATCH');
    assert.equal((await link(independent.id, { conversationId:'8100', contactId:'9001' })).body.code, 'CONVERSATION_NOT_WHATSAPP');
    assert.equal((await link(independent.id, { conversationId:'8001', contactId:'9001' }, 'warehouse')).status, 403);
    assert.equal(order(independent.id).chatwootConversationId, '');
    console.log('PASS 7 forged, foreign-user and expired contexts, unknown, non-WhatsApp and mismatched conversations are refused');

    // Manual link after review: preview shows what the employee confirms; then the link is written with an audit row.
    const before11 = money(system.readDb());
    r = await system.api(`/api/orders/${independent.id}/chatwood-link/preview?conversationId=8001`);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.body.conversation.whatsappMasked, r.body.canLink, r.body.evidence.orderMentionedByStaff, r.body.evidence.otherOrdersOfContact], ['0101****001', true, false, 2]);
    r = await link(independent.id, { conversationId:'8001', contactId:'9001' });
    assert.equal(r.status, 200, r.text);
    assert.equal(order(independent.id).chatwoodLink.source, 'manual-verified');
    assert.equal(audits(independent.id, 'ORDER_CHATWOOD_LINKED').length, 1);
    console.log('PASS a manual link is written only after the server verified the conversation, with an audit row');

    // ---- 5 + 6. A staff message naming an order makes a suggestion, never a link.
    const coreL1 = orderCore(order('ORD-L1'));
    r = await panel({ conversationId:'8002', contactId:'9002' });
    assert.deepEqual(r.body.suggestions.map(row => row.orderId), ['ORD-L1']);
    assert.equal(r.body.suggestions[0].recipientIsContactPhone, true);
    assert.equal(r.body.canLink, true);
    assert.equal(order('ORD-L1').chatwootConversationId, undefined, 'a mention alone links nothing');
    r = await system.api('/api/orders/ORD-L1/chatwood-link/suggestions');
    assert.deepEqual(r.body.suggestions.map(row => row.conversationId).sort(), ['8002', '8003']);
    // A "suggestion" for an order no staff message named in that conversation is refused.
    assert.equal((await link(second.id, { conversationId:'8002', contactId:'9002', source:'suggestion' })).body.code, 'SUGGESTION_NOT_FOUND');
    console.log('PASS 5+6 a staff mention gives a suggestion; nothing is linked until an employee confirms');

    r = await link('ORD-L1', { conversationId:'8002', contactId:'9002', source:'suggestion' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([order('ORD-L1').chatwootConversationId, order('ORD-L1').chatwootContactId, order('ORD-L1').chatwoodLink.source], ['8002', '9002', 'suggestion-confirmed']);
    assert.equal(orderCore(order('ORD-L1')), coreL1, 'only the link fields changed');
    console.log('PASS 5 a confirmed suggestion links the order with its evidence');

    // ---- 8. Repeating the same link changes nothing and writes no second audit row.
    r = await link('ORD-L1', { conversationId:'8002', contactId:'9002', source:'suggestion' });
    assert.deepEqual([r.status, r.body.existing], [200, true]);
    r = await link('ORD-L1', { conversationId:'8004', contactId:'9002' });
    assert.deepEqual([r.status, r.body.existing], [200, true], 'another conversation of the same contact is the same customer');
    assert.equal(audits('ORD-L1', 'ORDER_CHATWOOD_LINKED').length, 1);
    console.log('PASS 8 repeated links are idempotent');

    // ---- 9. A mention in another customer's conversation is a conflict, not a suggestion, and cannot link.
    r = await panel({ conversationId:'8003', contactId:'9003' });
    assert.deepEqual(r.body.suggestions, []);
    assert.deepEqual(r.body.mentionConflicts.map(row => [row.orderId, row.linkedConversationId]), [['ORD-L1', '8002']]);
    r = await link('ORD-L1', { conversationId:'8003', contactId:'9003', source:'suggestion' });
    assert.deepEqual([r.status, r.body.code], [409, 'ORDER_ALREADY_LINKED']);
    assert.equal(order('ORD-L1').chatwootConversationId, '8002');
    console.log('PASS 9 a conflicting mention is shown as a conflict and refused');

    // ---- 10. Owner/manager unlink or move a wrong link, with the reason and before/after kept.
    assert.equal((await correct('ORD-L1', { action:'unlink', reason:'ربط غلط' }, 'cashier')).status, 403);
    assert.equal((await correct('ORD-L1', { action:'unlink', reason:'' })).body.code, 'REASON_REQUIRED');
    r = await correct('ORD-L1', { action:'unlink', reason:'الطلب لعميل تاني' }, 'manager');
    assert.equal(r.status, 200, r.text);
    let row = order('ORD-L1');
    assert.deepEqual([row.chatwootConversationId, row.chatwootContactId, row.chatwoodLink], [undefined, undefined, undefined]);
    assert.deepEqual([row.chatwoodLinkHistory[0].before.conversationId, row.chatwoodLinkHistory[0].after, row.chatwoodLinkHistory[0].by, row.chatwoodLinkHistory[0].reason], ['8002', null, 'manager', 'الطلب لعميل تاني']);
    const unlinkAudit = audits('ORD-L1', 'ORDER_CHATWOOD_LINK_CORRECTED')[0];
    assert.deepEqual([unlinkAudit.before.conversationId, unlinkAudit.after, unlinkAudit.reason, unlinkAudit.username], ['8002', null, 'الطلب لعميل تاني', 'manager']);
    assert.ok(unlinkAudit.createdAt);
    assert.equal((await correct('ORD-L1', { action:'unlink', reason:'فك ربط تاني' })).body.code, 'ORDER_NOT_LINKED');
    r = await link('ORD-L1', { conversationId:'8003', contactId:'9003' });
    assert.equal(r.status, 200, r.text);
    r = await correct('ORD-L1', { action:'relink', conversationId:'8002', contactId:'9002', reason:'رجوع للمحادثة الصح' });
    assert.equal(r.status, 200, r.text);
    row = order('ORD-L1');
    assert.deepEqual([row.chatwootConversationId, row.chatwoodLink.source, row.chatwoodLinkHistory.length, row.chatwoodLinkHistory[1].before.conversationId, row.chatwoodLinkHistory[1].after.conversationId], ['8002', 'corrected', 2, '8003', '8002']);
    // ---- 11 (checked here, before the whole-database save below, which is not a linking step).
    assert.equal(money(system.readDb()), before11, 'linking, suggestions and corrections changed no stock, invoice, payment, cash or customer');
    // A whole-database save from the browser cannot rewrite or erase the link or its history.
    const revision = (await system.api('/api/live-revision')).body.revision;
    const whole = (await system.api('/api/db')).body;
    Object.assign(whole.onlineOrders.find(item => item.id === 'ORD-L1'), { chatwootConversationId:'1', chatwoodLinkHistory:[] });
    whole.onlineOrders.push({ ...whole.onlineOrders.find(item => item.id === independent.id), id:'ORD-BROWSER', chatwootConversationId:'8001', chatwootContactId:'9001' });
    r = await system.api('/api/db', { method:'PUT', body:whole, headers:{ 'If-Match':revision } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([order('ORD-L1').chatwootConversationId, order('ORD-L1').chatwoodLinkHistory.length], ['8002', 2]);
    assert.deepEqual([order('ORD-BROWSER')?.chatwootConversationId, order('ORD-BROWSER')?.chatwootContactId], [undefined, undefined], 'a browser-made order brings no owner');
    console.log('PASS 10 corrections are owner/manager only, need a reason, and keep before/after in history and audit');

    // ---- 11. Linking, suggestions and corrections changed no stock, invoice, payment, cash or customer.
    console.log('PASS 11 no stock, invoice, payment, cash or customer changed during linking');

    // The Store being down: no new context is issued, but a context already issued still works.
    store.state.down = true;
    r = await panel({ conversationId:'8001', contactId:'9001' });
    assert.deepEqual([r.body.orderContext.ok, r.body.orderContext.code], [false, 'STORE_UNAVAILABLE']);
    r = await create({ phone:'01055550005', chatwoodContext:token });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.order.chatwootConversationId, '8001');
    store.state.down = false;
    console.log('PASS with the Store down no new context is issued; an issued one still works until it expires');
    console.log('chatwood verified linking tests passed');
  } catch (error) {
    console.error(`FAIL ${error.stack || error.message}`);
    if (system) console.error(system.output().slice(-2000));
    process.exitCode = 1;
  } finally {
    system?.stop();
    await store?.close();
  }
})();
