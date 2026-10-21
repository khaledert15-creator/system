"use strict";

// Partial shipping (Option B): a confirmed pre-order whose books are only partly on the shelf is split, with the
// customer's agreement to an extra shipping fee, into
//   part 1 — the original order, now holding only the books available now; it goes to the preparation queue and
//            keeps its number, payments, deposit and (for website orders) its website link;
//   part 2 — a new order for the missing books, a pre-order holding no copies, priced at the same unit prices and
//            charged the agreed extra shipping fee. It ships on its own when its books arrive.
// Each part therefore has its own invoice and shipment through the existing single-shipment workflow.
// Pure and synchronous: mutates the caller's DB snapshot (the caller writes it with expectedRevision) or throws an
// error with { status, code } leaving the caller to discard the snapshot.
const OrderFinance = require("./order-finance.js");

const MAX_EXTRA_SHIPPING_FEE = 10000;
const round = OrderFinance.round;

function splitError(status, code, message, details = {}) {
  return Object.assign(new Error(message), { status, code, details });
}

function isCancelled(order = {}) {
  return Boolean(order.deletedAt || order.cancelledAt) || order.workflowStage === "cancelled" || ["ملغي", "cancelled", "canceled"].includes(String(order.status || "").toLowerCase());
}

function createSplitShipment(deps) {
  const { availableStock, countHoldStock, aggregateOrderLines, reserveOrderInventory, applyBackorderStage, applyQuickOrderPayment, appendOrderAudit, nextId, confirmedPaid } = deps;

  // Copies of each book that part 1 can take now. A book the packer reported missing for this order stays missing
  // until a stock count clears the hold (same rule as the automatic pre-order check).
  function availableNow(db, order) {
    const books = new Map((db.books || []).map(book => [book.id, book]));
    const reported = aggregateOrderLines(order.preparationIssue?.missingLines || []);
    const result = new Map();
    for (const [bookId, qty] of aggregateOrderLines(order.lines || [])) {
      const book = books.get(bookId);
      const held = book && reported.has(bookId) && countHoldStock(book) > 0;
      result.set(bookId, { needed:qty, now:!book || book.deletedAt || held ? 0 : Math.max(0, Math.min(qty, availableStock(book))) });
    }
    return result;
  }

  // Which books would ship now and which later, for the order screen and the approval preview.
  function preview(db, order) {
    const books = new Map((db.books || []).map(book => [book.id, book]));
    const rows = [...availableNow(db, order)].map(([bookId, { needed, now }]) => ({ bookId, name:books.get(bookId)?.name || bookId, qty:needed, now, later:needed - now }));
    const nowQty = rows.reduce((sum, row) => sum + row.now, 0), laterQty = rows.reduce((sum, row) => sum + row.later, 0);
    return { rows, nowQty, laterQty, splittable:nowQty > 0 && laterQty > 0 };
  }

  // Splits the order's lines (in order) between what ships now and what waits, keeping each line's price and
  // discount. A line-level amount discount is shared in proportion to quantity.
  function partitionLines(order, allocation) {
    const remainingNow = new Map([...allocation].map(([bookId, value]) => [bookId, value.now]));
    const now = [], later = [];
    const part = (line, qty) => {
      const copy = { ...line, qty };
      if (line.discountType === "amount" && line.discountScope !== "unit" && Number(line.qty) > 0) copy.discount = round(Number(line.discount || 0) * qty / Number(line.qty));
      return copy;
    };
    for (const line of order.lines || []) {
      const qty = Math.trunc(Number(line.qty) || 0);
      if (qty <= 0) continue;
      const take = Math.min(qty, remainingNow.get(line.bookId) || 0);
      remainingNow.set(line.bookId, (remainingNow.get(line.bookId) || 0) - take);
      if (take > 0) now.push(part(line, take));
      if (qty - take > 0) later.push(part(line, qty - take));
    }
    return { now, later };
  }

  // An order-level amount discount (website coupon) is used on part 1 first and any remainder on part 2; a percent
  // discount applies to both parts.
  function partTotals(order, nowLines, laterLines, extraShippingFee) {
    const type = order.orderDiscountType === "amount" ? "amount" : "percent";
    const discount = Number(order.orderDiscount || 0);
    const first = OrderFinance.calculateOrder(nowLines, { orderDiscount:0, orderDiscountType:"amount", shippingCost:0 });
    const firstDiscount = type === "amount" ? Math.min(discount, first.goods) : discount;
    const secondDiscount = type === "amount" ? round(Math.max(0, discount - firstDiscount)) : discount;
    return {
      first:OrderFinance.calculateOrder(nowLines, { orderDiscount:firstDiscount, orderDiscountType:type, shippingCost:Number(order.shippingFee ?? order.shippingCost ?? 0) }),
      second:OrderFinance.calculateOrder(laterLines, { orderDiscount:secondDiscount, orderDiscountType:type, shippingCost:extraShippingFee }),
      firstDiscount, secondDiscount, type
    };
  }

  function parseExtraShippingFee(value) {
    const amount = OrderFinance.normalizeNumber(value);
    if (value === "" || value == null || !Number.isFinite(amount) || amount < 0 || amount > MAX_EXTRA_SHIPPING_FEE) throw splitError(400, "SPLIT_FEE_INVALID", `رسوم شحن الشحنة الثانية يجب أن تكون رقمًا من 0 إلى ${MAX_EXTRA_SHIPPING_FEE} ج.م.`);
    return round(amount);
  }

  function split(db, order, payload = {}, user, nowValue = new Date()) {
    const now = nowValue.toISOString(), by = user.name || user.username;
    if (!order || order.deletedAt) throw splitError(404, "ORDER_NOT_FOUND", "الطلب غير موجود.");
    if (isCancelled(order)) throw splitError(409, "ORDER_CANCELLED", "الطلب ملغي.");
    if (order.splitShipment?.childOrderIds?.length) throw splitError(409, "ORDER_ALREADY_SPLIT", `الطلب مقسم بالفعل (${order.splitShipment.childOrderIds.join("، ")}).`);
    if (order.splitFromOrderId) throw splitError(409, "ORDER_IS_SPLIT_PART", `هذا الطلب هو الشحنة الثانية للطلب ${order.splitFromOrderId} ولا يُقسم مرة أخرى.`);
    if (order.workflowStage !== "awaiting_stock" || !order.confirmedAt || order.saleId || order.shipmentId) throw splitError(409, "ORDER_NOT_SPLITTABLE", "التقسيم متاح فقط لطلب مؤكد في الحجز المسبق قبل الفاتورة والشحن.");
    if (payload.customerConsent !== true) throw splitError(409, "SPLIT_CONSENT_REQUIRED", "أكد أن العميل وافق على الشحن على دفعتين وعلى رسوم الشحنة الثانية.");
    const extraShippingFee = parseExtraShippingFee(payload.extraShippingFee);
    const consentChannel = String(payload.consentChannel || "").trim().slice(0, 40) || "واتساب";
    const consentNote = String(payload.consentNote || "").trim().slice(0, 500);

    const allocation = availableNow(db, order);
    const nowQty = [...allocation.values()].reduce((sum, value) => sum + value.now, 0);
    const laterQty = [...allocation.values()].reduce((sum, value) => sum + value.needed - value.now, 0);
    if (nowQty <= 0) throw splitError(409, "NOTHING_AVAILABLE_NOW", "لا يوجد أي كتاب من الطلب متاح الآن؛ لا توجد شحنة أولى للتقسيم.");
    if (laterQty <= 0) throw splitError(409, "ORDER_FULLY_AVAILABLE", "كل كتب الطلب متاحة الآن؛ استخدم «نقل للتجهيز الآن» بدل التقسيم.");

    const { now:nowLines, later:laterLines } = partitionLines(order, allocation);
    const totals = partTotals(order, nowLines, laterLines, extraShippingFee);
    const paid = round(confirmedPaid(db, order));
    if (paid > totals.first.total) throw splitError(409, "PAID_EXCEEDS_FIRST_SHIPMENT", `المدفوع (${paid} ج.م) أكبر من إجمالي الشحنة الأولى (${totals.first.total} ج.م). سوِّ المبلغ ماليًا قبل التقسيم.`, { paid, firstTotal:totals.first.total });

    const original = { lines:JSON.parse(JSON.stringify(order.lines || [])), total:round(Number(order.total || 0)), subtotal:order.subtotal, discountTotal:order.discountTotal, orderDiscount:order.orderDiscount };
    db.onlineOrders = db.onlineOrders || [];
    const childId = nextId("ORD-", db.onlineOrders);
    const issue = order.preparationIssue ? JSON.parse(JSON.stringify(order.preparationIssue)) : null;

    // Part 1: keeps the order number, payments and website link; reserves its books and goes to preparation.
    Object.assign(order, { lines:totals.first.lines, subtotal:totals.first.subtotal, discountTotal:totals.first.discountTotal, total:totals.first.total });
    if (totals.type === "amount") order.orderDiscount = totals.firstDiscount;
    reserveOrderInventory(db, order, user, order.lines);
    order.backorderLines = [];
    if (order.preparationIssue) { order.preparationIssueHistory = [...(order.preparationIssueHistory || []), { ...order.preparationIssue, resolvedAt:now, resolvedBy:by, resolution:`نُقل الناقص للطلب ${childId}` }]; delete order.preparationIssue; }
    applyBackorderStage(order, user, now);
    const payment = OrderFinance.calculatePayment(order.total, paid);
    Object.assign(order, {
      paidAmount:payment.paidAmount, remainingAmount:payment.remainingAmount, remaining:payment.remainingAmount, amountDueAtDelivery:payment.amountDueAtDelivery, paymentStatus:payment.paymentStatus,
      splitShipment:{ childOrderIds:[childId], splitAt:now, splitBy:by, splitByUsername:user.username, extraShippingFee, consent:{ confirmed:true, channel:consentChannel, note:consentNote, recordedBy:by, recordedAt:now, websitePreference:order.websiteSplitShipmentPreference || "", websiteQuotedFee:order.websiteSplitExtraShippingFee ?? null }, original },
      splitPart:1, carriedOverFromBackorder:true, carriedOverAt:now, preparingBy:null, preparingByUsername:null, updatedAt:now
    });
    // Part 2, created after part 1 took its copies so the missing books cannot be reserved for it: same customer,
    // address and carrier; cash on delivery; never a website-linked order of its own.
    const child = {
      id:childId, date:now.slice(0, 10), customerId:order.customerId, customerName:order.customerName, phone:order.phone, alternativePhone:order.alternativePhone || "",
      governorate:order.governorate || "", city:order.city || "", address:order.address || "", addressMark:order.addressMark || "",
      source:order.source || "", sourcePlatform:order.sourcePlatform || "", shippingCompany:order.shippingCompany || "",
      paymentMethod:"الدفع عند الاستلام", shippingCost:totals.second.shipping, shippingFee:totals.second.shipping, shippingFeeOverride:true, shippingPriceSource:`split:${order.id}`,
      orderDiscount:totals.type === "amount" ? totals.secondDiscount : Number(order.orderDiscount || 0), orderDiscountType:totals.type, couponCode:order.couponCode || "",
      status:"مسودة", workflowStage:"draft", lines:totals.second.lines, subtotal:totals.second.subtotal, discountTotal:totals.second.discountTotal, total:totals.second.total,
      notes:order.notes || "", splitFromOrderId:order.id, splitPart:2, parentWebsiteOrderNumber:order.websiteOrderNumber || "",
      preorderConsent:order.preorderConsent || {}, websitePreorderConsent:order.websitePreorderConsent === true,
      createdAt:now, createdBy:by, createdByUsername:user.username, updatedAt:now, deletedAt:null
    };
    // The packer's missing report travels with the missing books so the hold keeps applying to them.
    if (issue) child.preparationIssue = issue;
    applyQuickOrderPayment(db, child, { paidAmount:0, paymentConfirmed:false, paymentPlan:"cash_on_delivery", paymentMethod:"الدفع عند الاستلام" }, user);
    db.onlineOrders.push(child);
    reserveOrderInventory(db, child, user, child.lines, { allowBackorder:true });
    Object.assign(child, { confirmedAt:now, confirmedBy:by, confirmedByUsername:user.username });
    applyBackorderStage(child, user, now);

    const names = rows => rows.map(line => `${line.bookId}×${line.qty}`).join("، ");
    appendOrderAudit(db, user, order, "تقسيم الشحن: شحن المتوفر الآن", `الشحنة الأولى: ${names(order.lines)} · الشحنة الثانية ${childId}: ${names(child.lines)} · رسوم الشحنة الثانية ${extraShippingFee} ج.م · موافقة العميل (${consentChannel})${consentNote ? `: ${consentNote}` : ""}`);
    appendOrderAudit(db, user, child, "إنشاء الشحنة الثانية من تقسيم طلب", `من الطلب ${order.id}${order.websiteOrderNumber ? ` (${order.websiteOrderNumber})` : ""} · رسوم الشحن ${extraShippingFee} ج.م`);
    return { order, child };
  }

  // «شحن المتوفر وإلغاء الناقص»: the customer agreed to receive only the books available now. The missing copies are
  // removed from the order (no second shipment, no extra fee), the total is recalculated, and the order goes to the
  // preparation queue holding the books it keeps. Website orders keep using the two-shipment split, because the Store
  // shows the customer its own copy of the items.
  function dropMissing(db, order, payload = {}, user, nowValue = new Date()) {
    const now = nowValue.toISOString(), by = user.name || user.username;
    if (!order || order.deletedAt) throw splitError(404, "ORDER_NOT_FOUND", "الطلب غير موجود.");
    const operationKey = String(payload.operationKey || "").trim().slice(0, 120);
    const previous = operationKey && (order.droppedLines || []).find(entry => entry.operationKey === operationKey);
    if (previous) return { order, dropped:previous, existing:true };
    if (isCancelled(order)) throw splitError(409, "ORDER_CANCELLED", "الطلب ملغي.");
    if (order.workflowStage !== "awaiting_stock" || !order.confirmedAt || order.saleId || order.shipmentId) throw splitError(409, "ORDER_NOT_DROPPABLE", "الإجراء ده متاح بس لطلب مؤكد في الحجز المسبق قبل الفاتورة والشحن.");
    if (order.websiteOrderNumber || order.parentWebsiteOrderNumber) throw splitError(409, "WEBSITE_ORDER_DROP_UNAVAILABLE", "طلب موقع: العميل شايف كتبه على الموقع، فاستخدم «شحنتين» أو عدّل الطلب بالاتفاق معاه.");
    if (payload.customerConsent !== true) throw splitError(409, "DROP_CONSENT_REQUIRED", "أكّد إن العميل وافق ياخد المتوفر بس ويلغي الناقص.");
    const consentChannel = String(payload.consentChannel || "").trim().slice(0, 40) || "واتساب";
    const consentNote = String(payload.consentNote || "").trim().slice(0, 500);

    const allocation = availableNow(db, order);
    const nowQty = [...allocation.values()].reduce((sum, value) => sum + value.now, 0);
    const laterQty = [...allocation.values()].reduce((sum, value) => sum + value.needed - value.now, 0);
    if (nowQty <= 0) throw splitError(409, "NOTHING_AVAILABLE_NOW", "مفيش أي كتاب من الطلب متاح دلوقتي.");
    if (laterQty <= 0) throw splitError(409, "ORDER_FULLY_AVAILABLE", "كل كتب الطلب متاحة دلوقتي؛ استخدم «نقل للتجهيز الآن».");

    const { now:keepLines, later:droppedLines } = partitionLines(order, allocation);
    const totals = partTotals(order, keepLines, droppedLines, 0);
    const paid = round(confirmedPaid(db, order));
    if (paid > totals.first.total) throw splitError(409, "PAID_EXCEEDS_NEW_TOTAL", `المدفوع (${paid} ج.م) أكبر من الإجمالي الجديد (${totals.first.total} ج.م). صحّح الدفعة أو سجّل رد الفرق الأول.`, { paid, total:totals.first.total });

    const totalBefore = round(Number(order.total || 0));
    Object.assign(order, { lines:totals.first.lines, subtotal:totals.first.subtotal, discountTotal:totals.first.discountTotal, total:totals.first.total });
    if (totals.type === "amount") order.orderDiscount = totals.firstDiscount;
    reserveOrderInventory(db, order, user, order.lines);
    order.backorderLines = [];
    if (order.preparationIssue) { order.preparationIssueHistory = [...(order.preparationIssueHistory || []), { ...order.preparationIssue, resolvedAt:now, resolvedBy:by, resolution:"اتلغى الناقص بموافقة العميل" }]; delete order.preparationIssue; }
    applyBackorderStage(order, user, now);
    const payment = OrderFinance.calculatePayment(order.total, paid);
    const entry = { at:now, by, username:user.username, operationKey, lines:droppedLines, totalBefore, totalAfter:order.total, consent:{ confirmed:true, channel:consentChannel, note:consentNote } };
    Object.assign(order, {
      paidAmount:payment.paidAmount, remainingAmount:payment.remainingAmount, remaining:payment.remainingAmount, amountDueAtDelivery:payment.amountDueAtDelivery, paymentStatus:payment.paymentStatus,
      droppedLines:[...(order.droppedLines || []), entry], carriedOverFromBackorder:true, carriedOverAt:now, preparingBy:null, preparingByUsername:null, updatedAt:now
    });
    const names = rows => rows.map(line => `${line.bookId}×${line.qty}`).join("، ");
    appendOrderAudit(db, user, order, "شحن المتوفر وإلغاء الناقص", `اتلغى: ${names(droppedLines)} · الإجمالي ${totalBefore} ← ${order.total} ج.م · موافقة العميل (${consentChannel})${consentNote ? `: ${consentNote}` : ""}`);
    return { order, dropped:entry, existing:false };
  }

  // The parts of a split order as one list (part 1 first), for the Store link and the Chatwood panel.
  function parts(db, order) {
    if (!order) return [];
    const parent = order.splitFromOrderId ? (db.onlineOrders || []).find(item => item.id === order.splitFromOrderId) || null : order;
    if (!parent?.splitShipment?.childOrderIds?.length) return [];
    const children = parent.splitShipment.childOrderIds.map(id => (db.onlineOrders || []).find(item => item.id === id && !item.deletedAt)).filter(Boolean);
    return [parent, ...children];
  }

  return { availableNow, preview, partitionLines, partTotals, parseExtraShippingFee, split, dropMissing, parts };
}

// Fields only the split endpoint may set; a browser save of the whole database keeps the server's values.
const SPLIT_SERVER_FIELDS = ["splitShipment", "splitFromOrderId", "splitPart", "parentWebsiteOrderNumber"];
function preserveSplitFields(current = {}, next = {}) {
  const currentOrders = new Map((current.onlineOrders || []).filter(order => order && order.id).map(order => [order.id, order]));
  for (const order of next.onlineOrders || []) {
    if (!order || typeof order !== "object") continue;
    const previous = currentOrders.get(order.id) || {};
    for (const key of SPLIT_SERVER_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(previous, key)) order[key] = JSON.parse(JSON.stringify(previous[key]));
      else delete order[key];
    }
  }
  return next;
}

module.exports = { MAX_EXTRA_SHIPPING_FEE, SPLIT_SERVER_FIELDS, splitError, createSplitShipment, preserveSplitFields };
