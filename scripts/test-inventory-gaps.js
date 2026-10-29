'use strict';
// Stock audit 2026-10-30: each case is a way the shelf count could go wrong — copies put back twice, copies reserved
// for an order sent elsewhere, history rewritten by a save — and is now refused or handled.
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const H = require('./integration-test-helpers.js');
const Refusal = require('../app/order-refusal.js'), Returns = require('../app/returns.js'), Integrity = require('../app/purchase-inventory-integrity.js');

let n = 0;
const actor = { username:'owner', name:'owner', uuid:() => `u${++n}` };
const book = (db, id) => db.books.find(item => item.id === id);
const batchTotal = (db, id) => db.inventoryBatches.filter(item => item.productId === id && !item.deletedAt).reduce((sum, item) => sum + Number(item.remainingQty || 0), 0);

// An online order invoiced for 2 copies of B1 (stock 5 → 3 after the sale) with a shipment on the road.
function shippedOrderDb(extra = {}) {
  return H.fixtureDb({
    customers:[{ id:'C1', name:'عميل', balance:200 }],
    books:[{ id:'B1', name:'كتاب', stock:3, price:100 }],
    inventoryBatches:[{ id:'BT1', batchId:'BT1', productId:'B1', remainingQty:3, unitCost:50 }],
    onlineOrders:[{ id:'O1', customerId:'C1', total:200, status:'خرج للتوصيل', workflowStage:'shipped', saleId:'I1', shipmentId:'S1', lines:[{ bookId:'B1', qty:2, price:100 }] }],
    sales:[{ id:'I1', onlineOrderId:'O1', customerId:'C1', total:200, paid:0, remaining:200, status:'معتمدة', lines:[{ bookId:'B1', qty:2, price:100, finalNet:200, batchAllocations:[{ batchId:'BT1', qty:2, unitCost:50 }] }] }],
    shipments:[{ id:'S1', onlineOrderId:'O1', invoiceId:'I1', trackingNumber:'EG1', carrier:'بوسطة', status:'خرج للتوصيل' }],
    orderRefunds:[], ...extra
  });
}

async function cancelShipmentAfterReturn() {
  for (const mode of ['refusal', 'full return', 'partial return']) {
    const db = shippedOrderDb();
    if (mode === 'refusal') Refusal.applyRefusal(db, 'O1', { operationKey:'k', outcome:'keep_deposit', carrierCharged:'yes' }, actor);
    else Returns.createSaleReturn(db, { operationKey:'r', reason:'x', settlement:'no-settlement', lines:[{ documentId:'I1', lineIndex:0, qty:mode === 'full return' ? 2 : 1 }] }, actor);
    const stock = book(db, 'B1').stock;
    const system = await H.startSystem({ db, name:'gaps-cancel-' });
    try {
      const r = await system.api('/api/shipping/shipments/S1/cancel', { method:'POST', body:{ carrierCancelled:true, reason:'x', resolution:'cancel_order' } });
      assert.equal(r.status, 409, `${mode}: ${r.text}`);
      const after = system.readDb();
      assert.equal(book(after, 'B1').stock, stock, `${mode}: the returned copies are not put back a second time`);
      assert.equal(batchTotal(after, 'B1'), stock);
    } finally { system.stop(); }
  }
  console.log('PASS 1. cancelling the shipment of a refused or returned order does not restock it again');
}

async function reopenAfterPartialReturn() {
  const db = shippedOrderDb({ onlineOrders:[{ id:'O1', customerId:'C1', total:200, status:'تم التجهيز', workflowStage:'awaiting_shipping', preparedAt:'2026-10-01', confirmedAt:'2026-10-01', saleId:'I1', lines:[{ bookId:'B1', qty:2, price:100 }] }], shipments:[] });
  Returns.createSaleReturn(db, { operationKey:'r', reason:'x', settlement:'no-settlement', lines:[{ documentId:'I1', lineIndex:0, qty:1 }] }, actor);
  const system = await H.startSystem({ db, name:'gaps-reopen-' });
  try {
    const r = await system.api('/api/orders/O1/reopen-for-edit', { method:'POST', body:{ confirm:true, operationKey:'e1' } });
    assert.equal(r.status, 409, r.text); assert.equal(r.body.code, 'SALE_HAS_RETURN');
    const after = system.readDb();
    assert.equal(book(after, 'B1').stock, 4); assert.equal(after.sales[0].status, 'مرتجع جزئي');
  } finally { system.stop(); }
  console.log('PASS 2. an order whose invoice has a return cannot be reopened (its invoice is not voided twice)');
}

async function voidPackedOrderInvoice() {
  const db = H.fixtureDb();
  db.books = [{ id:'B1', name:'One', price:100, cost:60, stock:1, reservedStock:0, supplierId:'S001' }, { id:'B2', name:'Other', price:100, cost:60, stock:10, reservedStock:0, supplierId:'S001' }];
  db.inventoryBatches = db.books.map(item => ({ id:`BATCH-${item.id}`, productId:item.id, bookId:item.id, remainingQty:item.stock, unitCost:60, createdAt:'2026-10-01T00:00:00.000Z' }));
  // A legacy order: confirmed, its reservation already gone, no invoice. A save must not try to reserve it again.
  db.onlineOrders = [{ id:'ORD-OLD', customerId:'', status:'قيد التجهيز', workflowStage:'awaiting_preparation', confirmedAt:'2026-09-01', lines:[{ bookId:'B1', qty:5, price:100 }], inventoryReservation:{ status:'consumed', lines:[{ bookId:'B1', qty:5 }] } }];
  const system = await H.startSystem({ db, name:'gaps-void-' });
  try {
    const order = id => system.readDb().onlineOrders.find(item => item.id === id), stock = id => book(system.readDb(), id);
    const quick = async key => { const r = await system.api('/api/orders/quick', { method:'POST', body:{ phone:`010111122${key}`, customerName:`c${key}`, governorate:'القاهرة', city:'مدينة نصر', address:'x', shippingCompany:'البريد المصري', requestId:`k${key}`, lines:[{ bookId:'B1', qty:1 }], duplicateOverrideReason:'separate order test' } }); assert.ok([200, 201].includes(r.status), r.text); return r.body.order.id; };
    const A = await quick('01');
    assert.equal((await system.api(`/api/orders/${A}/confirm`, { method:'POST', body:{} })).status, 200);
    await system.api(`/api/orders/${A}/prepare/start`, { method:'POST', body:{} });
    await system.api(`/api/orders/${A}/prepare/checklist`, { method:'PATCH', body:{ doneBookIds:['B1'] } });
    let r = await system.api(`/api/orders/${A}/prepare/complete`, { method:'POST', body:{ packedWeightGrams:500 } });
    assert.equal(r.status, 200, r.text);
    const invoice = order(A).saleId; assert.ok(invoice);
    r = await system.api(`/api/sales/${invoice}/cancel`, { method:'POST', body:{} });
    assert.equal(r.status, 200, r.text);
    assert.equal(order(A).workflowStage, 'awaiting_preparation', 'the order goes back to preparation');
    assert.equal(order(A).inventoryReservation.status, 'active'); assert.equal(stock('B1').reservedStock, 1, 'its copy is reserved for it again');
    const B = await quick('02');
    assert.equal((await system.api(`/api/orders/${B}/confirm`, { method:'POST', body:{} })).status, 200);
    assert.equal(order(B).workflowStage, 'awaiting_stock', 'another order cannot take the copy');
    const page = await system.api('/api/db');
    page.body.books.find(item => item.id === 'B2').name = 'Other renamed';
    r = await system.api('/api/db', { method:'PUT', body:page.body, headers:{ 'If-Match':page.headers.get('x-db-revision') } });
    assert.equal(r.status, 200, r.text);
    assert.equal(order('ORD-OLD').inventoryReservation.status, 'consumed', 'a save does not resurrect an old reservation');
    assert.equal(stock('B1').reservedStock, 1);
  } finally { system.stop(); }
  console.log('PASS 3. voiding a packed order\'s invoice re-reserves its copies; unrelated saves keep working');
}

async function purchaseReturnOfReservedCopies() {
  const db = H.fixtureDb({
    books:[{ id:'B1', name:'Book', barcode:'111', stock:5, reservedStock:4, cost:10, supplierId:'S001' }],
    purchases:[{ id:'PUR-1', supplierId:'S001', type:'شراء', status:'مستلمة', total:50, paid:0, remaining:50, lines:[{ bookId:'B1', productId:'B1', qty:5, cost:10, batchId:'BAT-1' }] }],
    inventoryBatches:[{ id:'BAT-1', batchId:'BAT-1', productId:'B1', bookId:'B1', purchaseInvoiceId:'PUR-1', receivedQty:5, remainingQty:5, unitCost:10 }],
    stockMovements:[{ id:'MOV-1', bookId:'B1', type:'شراء', quantity:5, before:0, after:5, documentId:'PUR-1' }]
  });
  const system = await H.startSystem({ db, name:'gaps-pret-' });
  try {
    let r = await system.api('/api/returns/purchase', { method:'POST', body:{ purchaseId:'PUR-1', supplierId:'S001', lines:[{ documentId:'PUR-1', lineIndex:0, qty:5 }], reason:'x', operationKey:'K1' } });
    assert.equal(r.status, 409, r.text); assert.equal(r.body.code, 'RESERVED_STOCK_UNAVAILABLE');
    assert.equal(book(system.readDb(), 'B1').stock, 5);
    r = await system.api('/api/returns/purchase', { method:'POST', body:{ purchaseId:'PUR-1', supplierId:'S001', lines:[{ documentId:'PUR-1', lineIndex:0, qty:1 }], reason:'x', operationKey:'K2' } });
    assert.ok([200, 201].includes(r.status), r.text);
    assert.equal(book(system.readDb(), 'B1').stock, 4, 'the one free copy can go back');
  } finally { system.stop(); }
  console.log('PASS 4. a supplier return takes only free copies, never ones reserved for orders');
}

async function saveCannotRewriteStock() {
  const db = H.fixtureDb({
    books:[{ id:'B1', name:'Book', barcode:'111', stock:5, cost:10, supplierId:'S001' }, { id:'B2', name:'Empty', barcode:'222', stock:0, cost:10, supplierId:'S001' }],
    purchases:[{ id:'PUR-1', supplierId:'S001', type:'شراء', status:'مستلمة', total:50, paid:0, remaining:50, lines:[{ bookId:'B1', productId:'B1', qty:5, cost:10, batchId:'BAT-1' }] }],
    inventoryBatches:[{ id:'BAT-1', batchId:'BAT-1', productId:'B1', bookId:'B1', purchaseInvoiceId:'PUR-1', receivedQty:5, remainingQty:5, unitCost:10 }],
    stockMovements:[{ id:'MOV-1', bookId:'B1', type:'شراء', quantity:5, before:0, after:5, documentId:'PUR-1' }]
  });
  const system = await H.startSystem({ db, name:'gaps-put-' });
  try {
    const attempt = async (change, code) => {
      const page = await system.api('/api/db');
      change(page.body);
      const r = await system.api('/api/db', { method:'PUT', body:page.body, headers:{ 'If-Match':page.headers.get('x-db-revision') } });
      if (code) { assert.equal(r.status, 409, r.text); assert.equal(r.body.code, code); } else assert.equal(r.status, 200, r.text);
    };
    await attempt(page => { book(page, 'B1').stock = 50; }, 'STOCK_CHANGE_WITHOUT_MOVEMENT');
    await attempt(page => { page.stockMovements = []; }, 'INVENTORY_HISTORY_PROTECTED');
    await attempt(page => { page.stockMovements[0].quantity = 500; }, 'INVENTORY_HISTORY_PROTECTED');
    await attempt(page => { page.purchases = []; }, 'INVENTORY_HISTORY_PROTECTED');
    await attempt(page => { page.books = page.books.filter(item => item.id !== 'B1'); }, 'INVENTORY_HISTORY_PROTECTED');
    await attempt(page => { page.inventoryBatches[0].remainingQty = 999; }, 'INVENTORY_BATCH_STOCK_MISMATCH');
    await attempt(page => { page.stockMovements.push({ id:'MOV-NEG', bookId:'B1', type:'تسوية', quantity:-12, before:5, after:-7 }); book(page, 'B1').stock = -7; page.inventoryBatches[0].remainingQty = -7; }, 'NEGATIVE_STOCK_FORBIDDEN');
    await attempt(page => { book(page, 'B1').deletedAt = new Date().toISOString(); }, 'BOOK_HAS_STOCK');
    const after = system.readDb();
    assert.equal(book(after, 'B1').stock, 5); assert.equal(after.stockMovements.length, 1); assert.equal(after.purchases.length, 1);
    // What the page really does: the change comes with its movement and batch.
    await attempt(page => { page.stockMovements.push({ id:'MOV-ADJ', bookId:'B1', type:'جرد', quantity:-2, before:5, after:3 }); book(page, 'B1').stock = 3; page.inventoryBatches[0].remainingQty = 3; });
    await attempt(page => { book(page, 'B2').deletedAt = new Date().toISOString(); });
    assert.equal(book(system.readDb(), 'B1').stock, 3);
  } finally { system.stop(); }
  console.log('PASS 5. a save cannot change stock without movements, rewrite history, go negative or delete stocked books');
}

function adjustBookWithMismatchedBatches() {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../app/app.js'), 'utf8');
  const fn = name => { const start = source.search(new RegExp(`function ${name}\\(`)); assert(start >= 0, name); return source.slice(start, source.indexOf('\n}', start) + 2); };
  const c = {
    data:{ books:[{ id:'B1', name:'Book', stock:5, cost:10 }], inventoryBatches:[{ id:'BAT-1', productId:'B1', remainingQty:3, unitCost:10, purchaseDate:'2026-10-01' }] },
    PurchaseInventoryIntegrity:Integrity, currentUser:{ name:'owner' }, today:() => '2026-10-30', latestApprovedPurchaseCost:() => 10, productCoverPrice:() => 0,
    getBook(id) { return c.data.books.find(item => item.id === id); },
    productInventorySummary(id) { const rows = c.data.inventoryBatches.filter(item => item.productId === id && !item.deletedAt); const qty = rows.reduce((sum, item) => sum + item.remainingQty, 0); return { currentStockQty:qty, averageInventoryCost:qty ? rows.reduce((sum, item) => sum + item.remainingQty * item.unitCost, 0) / qty : 0 }; },
    createInventoryBatch({ productId, qty, unitCost, source }) { c.data.inventoryBatches.push({ id:`BAT-${c.data.inventoryBatches.length + 1}`, productId, remainingQty:qty, unitCost, source }); }
  };
  vm.createContext(c);
  vm.runInContext(['bookCountHold', 'clearCountHold', 'realignBookBatches', 'synchronizeStockAdjustment'].map(fn).join('\n'), c);
  const result = c.synchronizeStockAdjustment(c.data.books[0], 4, 'COUNT-1');
  assert.deepEqual([result.before, result.after], [5, 4]);
  assert.equal(c.data.books[0].stock, 4);
  assert.equal(c.data.inventoryBatches.reduce((sum, item) => sum + item.remainingQty, 0), 4, 'batches match the counted stock');
  assert.equal(c.data.books[0].batchRealignments[0].gap, 2, 'the realignment is kept on the book');
  assert.throws(() => c.synchronizeStockAdjustment(c.data.books[0], -1, 'ADJ-1'), /zero or more/);
  console.log('PASS 6. a book whose batches did not match its stock can still be adjusted and counted');
}

function reverseReturnFromTwoInvoices() {
  const sale = id => ({ id, customerId:'C1', total:300, paid:300, remaining:0, status:'معتمدة', lines:[{ bookId:'B1', qty:3, price:100, finalNet:300, batchAllocations:[{ batchId:'BT1', qty:3, unitCost:50 }] }] });
  const db = { customers:[{ id:'C1', name:'c', balance:0 }], books:[{ id:'B1', name:'k', stock:0 }], inventoryBatches:[{ id:'BT1', batchId:'BT1', productId:'B1', remainingQty:0, unitCost:50 }], sales:[sale('I1'), sale('I2')], returns:[], cash:[], cashAccounts:[], stockMovements:[] };
  const { record } = Returns.createSaleReturn(db, { operationKey:'a', reason:'x', settlement:'customer-credit', lines:[{ documentId:'I1', lineIndex:0, qty:3 }, { documentId:'I2', lineIndex:0, qty:3 }] }, actor);
  assert.equal(db.books[0].stock, 6);
  db.books[0].stock -= 2; db.inventoryBatches[0].remainingQty -= 2; // two of the returned copies were sold again
  assert.throws(() => Returns.reverseReturn(db, record.id, { reason:'y' }, actor), error => error.code === 'STOCK_ALREADY_USED');
  assert.equal(db.books[0].stock, 4); assert.equal(db.inventoryBatches[0].remainingQty, 4);
  db.books[0].reservedStock = 3; db.books[0].stock = 6; db.inventoryBatches[0].remainingQty = 6;
  assert.throws(() => Returns.reverseReturn(db, record.id, { reason:'y' }, actor), error => error.code === 'STOCK_ALREADY_USED', 'reserved copies are not taken back');
  console.log('PASS 7. undoing a return checks what is left per book and batch, so stock never goes negative');
}

(async () => {
  await cancelShipmentAfterReturn();
  await reopenAfterPartialReturn();
  await voidPackedOrderInvoice();
  await purchaseReturnOfReservedCopies();
  await saveCannotRewriteStock();
  adjustBookWithMismatchedBatches();
  reverseReturnFromTwoInvoices();
})().catch(error => { console.error(error); process.exitCode = 1; });
