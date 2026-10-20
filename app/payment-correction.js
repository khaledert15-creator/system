"use strict";

// Correcting a payment an employee recorded by mistake (wrong amount, wrong cash account or method, the wrong order,
// or money that never arrived / was entered twice). Nothing is edited in place: the original payment and its cash row
// are reversed and kept, a corrected payment and cash row replace them, and both orders, the invoice, the customer
// balance and an un-collected shipment are brought in line. Every correction keeps who, when, before, after and why.
//   preview(db, paymentId)                    → what can be corrected and why not
//   apply(db, input, user, deps)              → { correction, existing, orderIds, carrierNotice }

const OrderFinance = require("./order-finance.js");

const round = value => OrderFinance.round(Number(value || 0));
const list = (db, key) => (Array.isArray(db[key]) ? db[key] : (db[key] = []));
const live = item => item && !item.deletedAt && !["reversed", "void", "ملغى", "ملغاة"].includes(String(item.status || "").toLowerCase());
const PLAN_LABELS = { cash_on_delivery:"الدفع عند الاستلام", advance_cod:"مقدم + الباقي عند الاستلام", prepaid_full:"مدفوع بالكامل مسبقًا", cash:"كاش" };
const RECEIPT_METHODS = ["InstaPay", "محفظة إلكترونية", "تحويل بنكي", "كاش"];

function correctionError(status, code, message, details = {}) {
  return Object.assign(new Error(message), { status, code, details });
}

function orderClosedReason(db, order) {
  if (!order || order.deletedAt) return { code:"ORDER_NOT_FOUND", message:"الطلب غير موجود." };
  if (order.workflowStage === "cancelled" || order.status === "ملغي") return { code:"ORDER_CANCELLED", message:"الطلب ملغي؛ أي مبلغ عليه يتسوّى من «تسوية الإلغاء»." };
  const collected = list(db, "orderCollections").some(item => live(item) && (item.onlineOrderId === order.id || item.orderId === order.id || (order.shipmentId && item.shipmentId === order.shipmentId) || (order.saleId && item.invoiceId === order.saleId)));
  if (collected || order.collectionId || ["delivered", "returned"].includes(order.workflowStage) || order.status === "تم التسليم") return { code:"ORDER_COLLECTED", message:"اتسجّل تحصيل من شركة الشحن على الطلب ده؛ صحّح من شاشة التحصيلات." };
  if (list(db, "orderRefunds").some(item => live(item) && (item.orderId === order.id || (order.saleId && item.invoiceId === order.saleId)))) return { code:"ORDER_HAS_REFUND", message:"اتسجّل رد مبلغ على الطلب ده؛ التصحيح هنا ممكن يلخبط الرد." };
  return null;
}

function dayClosed(db, date) {
  return Boolean(date) && list(db, "dayClosings").some(item => !item.deletedAt && item.date === date);
}

function cashRowsOf(db, payment) {
  return list(db, "cash").filter(item => !item.deletedAt && (item.paymentId === payment.id || item.receiptId === payment.id));
}

function otherPaid(db, order, excludePaymentId) {
  return round(list(db, "orderPayments").filter(item => live(item) && item.confirmed !== false && item.orderId === order.id && item.id !== excludePaymentId).reduce((sum, item) => sum + Number(item.amount || 0), 0));
}

function preview(db, paymentId) {
  const payment = list(db, "orderPayments").find(item => item.id === paymentId);
  if (!payment) throw correctionError(404, "PAYMENT_NOT_FOUND", "الدفعة غير موجودة.");
  if (!live(payment) || payment.confirmed === false) throw correctionError(409, "PAYMENT_ALREADY_CORRECTED", "الدفعة دي اتصحّحت أو اتلغت قبل كده؛ افتح الطلب تاني.");
  const order = list(db, "onlineOrders").find(item => item.id === payment.orderId && !item.deletedAt);
  const blocker = orderClosedReason(db, order);
  const cash = cashRowsOf(db, payment);
  const cashDate = cash[0]?.date || String(payment.receivedAt || "").slice(0, 10);
  const blocked = blocker || (dayClosed(db, cashDate) ? { code:"DAY_CLOSED", message:`يومية ${cashDate} متقفلة؛ افتحها الأول من الخزينة.` } : null);
  const total = round(order?.total);
  return {
    payment:{ id:payment.id, amount:round(payment.amount), cashAccountId:payment.cashAccountId || "", cashAccountName:payment.cashAccountName || "", paymentMethod:payment.paymentMethod || "", receivedAt:payment.receivedAt || "", receivedBy:payment.receivedBy || "", orderId:payment.orderId },
    order:order ? { id:order.id, customerId:order.customerId || "", customerName:order.customerName || "", total, paidAmount:round(order.paidAmount), depositRequired:order.depositRequired ?? order.deposit?.required ?? null, shipped:Boolean(order.shipmentId || order.shippingExport) } : null,
    maxAmount:order ? round(Math.max(0, total - otherPaid(db, order, payment.id))) : 0,
    hasCashRow:cash.length > 0,
    cashAccounts:list(db, "cashAccounts").filter(item => item.active !== false && !item.deletedAt).map(item => ({ id:item.id, name:item.name })),
    receiptMethods:[...new Set([...RECEIPT_METHODS, payment.paymentMethod].filter(Boolean))],
    blocked
  };
}

// Brings one order (and its invoice, customer balance and un-collected shipment) in line after its paid amount
// moved by `delta`. Other components of paidAmount (if any) are kept because only the difference is applied.
function shiftOrderPaid(db, order, delta, now) {
  const before = { paid:round(order.paidAmount), remaining:round(order.remainingAmount ?? order.total) };
  let payment;
  try { payment = OrderFinance.calculatePayment(order.total, Math.max(0, round(before.paid + delta))); }
  catch { throw correctionError(409, "PAID_EXCEEDS_TOTAL", `المدفوع على الطلب ${order.id} هيبقى أكبر من إجماليه (${round(order.total)} ج.م).`, { orderId:order.id }); }
  const plan = order.paymentPlan;
  let nextPlan = plan;
  if (plan !== "cash") nextPlan = payment.paidAmount <= 0 ? "cash_on_delivery" : payment.remainingAmount <= 0 ? "prepaid_full" : "advance_cod";
  Object.assign(order, {
    paidAmount:payment.paidAmount, remainingAmount:payment.remainingAmount, remaining:payment.remainingAmount,
    amountDueAtDelivery:payment.amountDueAtDelivery, paymentStatus:payment.paymentStatus, updatedAt:now,
    ...(nextPlan !== plan ? { paymentPlan:nextPlan, paymentMethod:PLAN_LABELS[nextPlan] } : {})
  });
  if (order.websiteOrderNumber || order.deposit) {
    order.depositAmount = payment.paidAmount;
    if (order.deposit && typeof order.deposit === "object") order.deposit.amount = payment.paidAmount;
  }
  const invoice = list(db, "sales").find(item => !item.deletedAt && (item.id === order.saleId || item.onlineOrderId === order.id));
  if (invoice) {
    const oldRemaining = round(invoice.remainingAmount ?? invoice.remaining ?? 0);
    const paid = Math.max(0, round(Number(invoice.paidAmount ?? invoice.paid ?? 0) + delta)), remaining = Math.max(0, round(Number(invoice.total || 0) - paid));
    Object.assign(invoice, { paid, paidAmount:paid, remaining, remainingAmount:remaining, paymentStatus:paid <= 0 ? "unpaid" : remaining <= 0 ? "paid" : "partially_paid", updatedAt:now });
    const customer = list(db, "customers").find(item => item.id === invoice.customerId && !item.deletedAt);
    if (customer) { customer.balance = round(Number(customer.balance || 0) + remaining - oldRemaining); customer.updatedAt = now; }
  }
  let carrierNotice = false;
  const shipment = list(db, "shipments").find(item => !item.deletedAt && !item.cancelledAt && (item.id === order.shipmentId || item.onlineOrderId === order.id));
  if (shipment) {
    const previousDue = round(shipment.collectionAmount ?? shipment.amountDueAtDelivery ?? 0);
    Object.assign(shipment, { collectionAmount:payment.remainingAmount, amountDueAtDelivery:payment.remainingAmount, updatedAt:now });
    carrierNotice = previousDue !== payment.remainingAmount;
  } else if (order.shippingExport && before.remaining !== payment.remainingAmount) carrierNotice = true;
  return { before, after:{ paid:payment.paidAmount, remaining:payment.remainingAmount }, carrierNotice };
}

function apply(db, input, user, { randomUUID, nextId, appendOrderAudit, now = new Date().toISOString() }) {
  const operationKey = String(input.operationKey || "").trim().slice(0, 120);
  if (!operationKey) throw correctionError(400, "OPERATION_KEY_REQUIRED", "حدّث الصفحة وحاول تاني.");
  for (const order of list(db, "onlineOrders")) {
    const existing = (order.paymentCorrections || []).find(item => item.operationKey === operationKey);
    if (existing) return { correction:existing, existing:true, orderIds:[...new Set([existing.before.orderId, existing.after.orderId])], carrierNotice:Boolean(existing.carrierNotice) };
  }
  const context = preview(db, String(input.paymentId || ""));
  if (context.blocked) throw correctionError(409, context.blocked.code, context.blocked.message);
  const reason = String(input.reason || "").trim().slice(0, 500);
  if (reason.length < 3) throw correctionError(400, "REASON_REQUIRED", "اكتب سبب التصحيح.");
  const payment = list(db, "orderPayments").find(item => item.id === context.payment.id);
  const source = list(db, "onlineOrders").find(item => item.id === payment.orderId && !item.deletedAt);

  const cancel = input.cancelPayment === true;
  const amount = cancel ? 0 : round(OrderFinance.normalizeNumber(input.amount));
  if (!Number.isFinite(amount) || amount < 0) throw correctionError(400, "AMOUNT_INVALID", "اكتب المبلغ الصحيح.");
  if (!cancel && amount === 0) throw correctionError(400, "AMOUNT_INVALID", "المبلغ صفر؟ اختار «الدفعة ما وصلتش / متسجّلة مرتين» بدل كده.");
  const targetId = String(input.targetOrderId || source.id).trim().toUpperCase() || source.id;
  const target = targetId === source.id ? source : list(db, "onlineOrders").find(item => item.id === targetId && !item.deletedAt);
  if (!target) throw correctionError(404, "TARGET_ORDER_NOT_FOUND", `مفيش طلب برقم ${targetId}.`);
  const targetBlocker = target === source ? null : orderClosedReason(db, target);
  if (targetBlocker) throw correctionError(409, `TARGET_${targetBlocker.code}`, `الطلب ${target.id}: ${targetBlocker.message}`);
  if (target !== source && target.customerId !== source.customerId && input.confirmOtherCustomer !== true) {
    throw correctionError(409, "OTHER_CUSTOMER_CONFIRM_REQUIRED", `الطلب ${target.id} لعميل تاني (${target.customerName || target.customerId}). أكّد إن الدفعة بتاعته فعلًا.`, { targetCustomerName:target.customerName || "" });
  }
  const account = cancel ? null : list(db, "cashAccounts").find(item => item.id === String(input.cashAccountId || payment.cashAccountId || "") && item.active !== false && !item.deletedAt);
  if (!cancel && !account) throw correctionError(400, "CASH_ACCOUNT_REQUIRED", "اختار الخزنة أو الحساب اللي استلم الفلوس.");
  const method = cancel ? "" : (String(input.paymentMethod || payment.paymentMethod || "").trim().slice(0, 60) || "كاش");
  const unchanged = !cancel && target === source && amount === round(payment.amount) && account.id === payment.cashAccountId && method === (payment.paymentMethod || "");
  if (unchanged) throw correctionError(400, "NOTHING_CHANGED", "مفيش حاجة اتغيّرت في الدفعة.");

  const correctionId = `PCR-${randomUUID()}`;
  const originalCash = cashRowsOf(db, payment);
  const cashDate = originalCash[0]?.date || String(payment.receivedAt || now).slice(0, 10);
  const actor = user.name || user.username;

  // 1. Reverse the original payment and its cash rows (kept, never removed).
  Object.assign(payment, { status:"reversed", reversedAt:now, reversedBy:actor, reversedByUsername:user.username, reversalReason:"correction", correctionId, deletedAt:now, updatedAt:now });
  for (const row of originalCash) Object.assign(row, { deletedAt:now, reversedBy:actor, correctionId, updatedAt:now });

  // 2. Record the corrected payment (and cash row, when the original had one) on the right order.
  let replacement = null;
  if (!cancel) {
    const sourceKey = `${payment.sourceKey || payment.id}:correction:${correctionId}`;
    replacement = { ...payment, id:`PAY-${randomUUID()}`, sourceKey, idempotencyKey:sourceKey, orderId:target.id, invoiceId:target.saleId || "", customerId:target.customerId || payment.customerId,
      amount, paymentMethod:method, cashAccountId:account.id, cashAccountName:account.name, confirmed:true, status:"confirmed", correctionOf:payment.id, correctionId,
      correctedAt:now, correctedBy:actor, correctedByUsername:user.username, websiteOrderNumber:target.websiteOrderNumber || (target === source ? payment.websiteOrderNumber : "") || "" };
    for (const key of ["reversedAt", "reversedBy", "reversedByUsername", "reversalReason", "deletedAt"]) delete replacement[key];
    list(db, "orderPayments").push(replacement);
    if (originalCash.length) {
      list(db, "cash").push({ id:nextId("TX-", db.cash), date:cashDate, type:"قبض", direction:"in", locked:true, account:account.name, accountId:account.id, party:target.customerName || "", amount, category:"دفعة طلب",
        orderId:target.id, paymentId:replacement.id, sourceKey:`${sourceKey}:cash`, correctionId, note:`دفعة للطلب ${target.id} (تصحيح لدفعة ${round(payment.amount)} ج.م: ${reason})`, createdAt:now, createdBy:actor, createdByUsername:user.username });
    }
  }

  // 3. Bring the orders, invoices, customer balances and un-collected shipments in line.
  const effects = target === source
    ? [{ order:source, ...shiftOrderPaid(db, source, amount - round(payment.amount), now) }]
    : [{ order:source, ...shiftOrderPaid(db, source, -round(payment.amount), now) }, { order:target, ...shiftOrderPaid(db, target, amount, now) }];
  for (const order of new Set([source, target])) {
    const first = list(db, "orderPayments").find(item => live(item) && item.confirmed !== false && item.orderId === order.id);
    order.paymentReceiptId = first?.id || "";
  }

  const carrierNotice = effects.some(effect => effect.carrierNotice);
  const correction = {
    id:correctionId, operationKey, at:now, by:actor, username:user.username, reason, kind:cancel ? "cancel" : target !== source ? "move" : "edit",
    originalPaymentId:payment.id, newPaymentId:replacement?.id || "",
    before:{ orderId:source.id, amount:round(payment.amount), cashAccountName:payment.cashAccountName || "", paymentMethod:payment.paymentMethod || "" },
    after:{ orderId:target.id, amount, cashAccountName:account?.name || "", paymentMethod:method },
    orders:effects.map(effect => ({ orderId:effect.order.id, before:effect.before, after:effect.after })), carrierNotice
  };
  for (const order of new Set([source, target])) order.paymentCorrections = [...(Array.isArray(order.paymentCorrections) ? order.paymentCorrections : []), correction];
  const summary = cancel ? `إلغاء دفعة ${correction.before.amount} ج.م` : `${correction.before.amount} ج.م ${correction.before.cashAccountName} ← ${amount} ج.م ${account.name}${target !== source ? ` · نُقلت من ${source.id} إلى ${target.id}` : ""}`;
  db.audit = Array.isArray(db.audit) ? db.audit : [];
  const auditStart = db.audit.length;
  for (const order of new Set([source, target])) appendOrderAudit(db, user, order, "تصحيح دفعة", `${summary} · السبب: ${reason}`);
  for (const row of db.audit.slice(auditStart)) Object.assign(row, { operationType:"ORDER_PAYMENT_CORRECTED", before:correction.before, after:correction.after, correctionId });
  return { correction, existing:false, orderIds:[...new Set([source.id, target.id])], carrierNotice };
}

module.exports = { preview, apply, RECEIPT_METHODS };
