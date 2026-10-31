"use strict";
  // Business dates are Cairo dates: work between midnight and 2–3 am belongs to the new day, not the UTC one.
  const cairoDate = (value = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));


const Finance = require("./order-finance.js");
const Inventory = require("./purchase-inventory-integrity.js");
const crypto = require("crypto");

// Mutates only the request's private snapshot. The caller commits invoice and
// packing status together, or discards everything on validation/write failure.
function ensurePackingInvoice(db, order, user, nextId) {
  const fail = message => { throw Object.assign(new Error(message), { status:409 }); };
  const operationKey = `order-invoice:${order.id}`;
  const matches = (db.sales || []).filter(sale => sale.id === order.saleId || sale.onlineOrderId === order.id || sale.operationKey === operationKey);
  if (matches.length > 1) fail("توجد فواتير متعددة مرتبطة بالطلب؛ يلزم مراجعتها أولًا.");
  if (matches.length) {
    const sale = matches[0];
    if (sale.deletedAt || sale.cancelledAt || /ملغ|باطل|cancel|void/i.test(sale.status || "")) fail("الفاتورة المرتبطة ملغاة؛ يلزم مراجعة الطلب أولًا.");
    order.saleId = sale.id;
    return sale;
  }
  if (order.saleId) fail("الفاتورة المرتبطة غير موجودة؛ يلزم مراجعتها أولًا.");
  if (!order.lines?.length) fail("لا يمكن إصدار فاتورة بدون أصناف.");
  const customer = (db.customers || []).find(row => row.id === order.customerId && !row.deletedAt);
  if (!customer) fail("يجب ربط الطلب بعميل مسجل قبل إكمال التغليف.");
  for (const line of order.lines) if (!Number.isInteger(Number(line.qty)) || Number(line.qty) <= 0) fail("كمية الصنف غير صالحة.");
  const totals = Finance.calculateOrder(order.lines, { orderDiscount:order.orderDiscount, orderDiscountType:order.orderDiscountType, shippingCost:order.shippingFee ?? order.shippingCost ?? order.shipping ?? 0 });
  const payment = Finance.calculatePayment(totals.total, order.paidAmount || 0);
  const quantities = new Map();
  for (const line of totals.lines) quantities.set(line.bookId, (quantities.get(line.bookId) || 0) + line.qty);
  Inventory.assertInventoryConsistency(db, [...quantities.keys()]);
  for (const [bookId, qty] of quantities) {
    const book = (db.books || []).find(row => row.id === bookId && !row.deletedAt);
    if (!book) fail("أحد أصناف الطلب غير موجود.");
    const ownReserved = order.inventoryReservation?.status === "active" ? (order.inventoryReservation.lines || []).filter(row => row.bookId === bookId).reduce((sum,row) => sum + Number(row.qty || 0), 0) : 0;
    if (qty > Number(book.stock || 0) - Number(book.reservedStock || 0) - Math.max(0, Number(book.countHoldQty || 0)) + ownReserved) fail(`المخزون المتاح لا يكفي للصنف «${book.name}».`);
    const batches = (db.inventoryBatches || []).filter(row => !row.deletedAt && (row.productId || row.bookId) === bookId && Number(row.remainingQty) > 0);
    const count = batches.reduce((sum,row) => sum + Number(row.remainingQty), 0);
    const average = count ? batches.reduce((sum,row) => sum + Number(row.remainingQty) * Number(row.unitCost || 0), 0) / count : 0;
    if (totals.lines.some(line => line.bookId === bookId && line.finalNet / line.qty < average)) fail(`صافي سعر «${book.name}» أقل من متوسط التكلفة.`);
  }
  const now = new Date().toISOString(), id = nextId("INV-", db.sales || []);
  const sale = {
    id, operationKey, onlineOrderId:order.id, date:cairoDate(now), customerId:customer.id,
    channel:"متجر إلكتروني", saleOperationType:"طلب أونلاين", status:"معتمدة", payment:order.paymentMethod,
    paymentStatus:payment.paymentStatus, paid:payment.paidAmount, paidAmount:payment.paidAmount,
    remaining:payment.remainingAmount, remainingAmount:payment.remainingAmount,
    subtotal:totals.subtotal, subtotalBeforeDiscount:totals.subtotalBeforeDiscount,
    productDiscountTotal:totals.productDiscountTotal, orderDiscount:totals.orderDiscountAmount,
    discount:totals.discountTotal, subtotalAfterDiscount:totals.goods, shipping:totals.shipping, shippingFee:totals.shipping, shippingCost:totals.shipping, shippingFeeOverride:Boolean(order.shippingFeeOverride), shippingPriceSource:order.shippingPriceSource, total:totals.total, notes:order.notes || "",
    customerSnapshot:{name:order.customerName || customer.name, phone:order.phone || customer.phone, governorate:order.governorate || customer.governorate, city:order.city || customer.city, address:order.address || customer.address},
    createdByUserId:user.id, createdByName:user.name, createdByUsername:user.username, createdByRole:user.role,
    pointsAwarded:0, createdAt:now, updatedAt:now, deletedAt:null,
    lines:totals.lines.map(line => ({...line, productId:line.bookId, quantity:line.qty, originalPrice:line.price, unitSellingPrice:line.finalUnitPrice, totalSellingPrice:line.finalNet}))
  };
  for (const line of sale.lines) {
    const book = db.books.find(row => row.id === line.bookId), before = Number(book.stock);
    const costing = Inventory.consumeBatchesFIFO(db, book.id, line.qty);
    Object.assign(line, {costMethod:"FIFO", batchAllocations:costing.allocations, costIncomplete:costing.costIncomplete, costOfGoodsSold:costing.costIncomplete ? null : costing.costOfGoodsSold, grossProfit:costing.costIncomplete ? null : Number((line.finalNet-costing.costOfGoodsSold).toFixed(2))});
    book.stock = before - line.qty; book.lastSale = sale.date; book.updatedAt = now;
    db.stockMovements ||= [];
    db.stockMovements.push({id:`MOV-${crypto.randomUUID()}`,bookId:book.id,productId:book.id,type:"بيع أونلاين",quantity:-line.qty,before,after:book.stock,documentId:id,documentNo:id,documentType:"فاتورة بيع",customerId:customer.id,partyName:customer.name,date:now,createdAt:now,user:user.name,username:user.username,userId:user.id,role:user.role,employeeName:user.name,employeeRole:user.role,costAtOperation:costing.costOfGoodsSold/line.qty,priceAtOperation:line.price,financialImpact:-line.finalNet,note:`طلب ${order.id}`});
  }
  if (order.inventoryReservation?.status === "active") {
    for (const line of order.inventoryReservation.lines || []) {
      const book = db.books.find(row => row.id === line.bookId);
      if (book) book.reservedStock = Math.max(0, Number(book.reservedStock || 0) - Number(line.qty || 0));
    }
    Object.assign(order.inventoryReservation, {status:"consumed", consumedAt:now, updatedAt:now, consumedBy:user.name || user.username, consumedByUsername:user.username, invoiceId:id});
  }
  customer.balance = Number((Number(customer.balance || 0) + sale.remaining).toFixed(2));
  for (const row of db.orderPayments || []) if (row.orderId === order.id && row.status !== "reversed") { row.invoiceId = id; row.updatedAt = now; }
  (db.sales ||= []).push(sale);
  Object.assign(order, {saleId:id, total:totals.total, amountDueAtDelivery:payment.remainingAmount, updatedAt:now});
  Inventory.assertInventoryConsistency(db, [...quantities.keys()]);
  return sale;
}

module.exports = { ensurePackingInvoice };
