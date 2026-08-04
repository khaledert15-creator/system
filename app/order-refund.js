(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrderRefunds = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const round = value => Number(Number(value || 0).toFixed(2));
  const list = (db, key) => Array.isArray(db?.[key]) ? db[key] : [];
  const active = item => item && !item.deletedAt && !["reversed", "void", "ملغى", "ملغاة"].includes(String(item.status || "").toLowerCase());
  const clone = value => JSON.parse(JSON.stringify(value));

  function resolveDocument(db, { orderId = "", invoiceId = "" } = {}) {
    const order = list(db, "onlineOrders").find(item => !item.deletedAt && (item.id === orderId || item.saleId === invoiceId));
    const invoice = list(db, "sales").find(item => !item.deletedAt && (item.id === invoiceId || (order && (item.id === order.saleId || item.onlineOrderId === order.id))));
    const customerId = String(order?.customerId || invoice?.customerId || "");
    const customer = list(db, "customers").find(item => !item.deletedAt && item.id === customerId) || null;
    if (!order && !invoice) throw Object.assign(new Error("الطلب أو الفاتورة غير موجودة."), { code:"DOCUMENT_NOT_FOUND", status:404 });
    return { order, invoice, customer, orderId:order?.id || orderId, invoiceId:invoice?.id || invoiceId, customerId };
  }

  function documentPayments(db, context) {
    const rows = list(db, "orderPayments").filter(item => active(item) && item.confirmed !== false && (
      (context.orderId && item.orderId === context.orderId) || (context.invoiceId && item.invoiceId === context.invoiceId)
    ));
    if (!rows.length && context.invoice && Number(context.invoice.paid ?? context.invoice.paidAmount ?? 0) > 0) {
      rows.push({ id:`SALE-PAID:${context.invoice.id}`, orderId:context.orderId, invoiceId:context.invoice.id, customerId:context.customerId, amount:round(context.invoice.paid ?? context.invoice.paidAmount), paymentMethod:context.invoice.payment || "غير محدد", cashAccountId:"", cashAccountName:context.invoice.payment || "", status:"confirmed", virtualReference:true });
    }
    return rows;
  }

  function settlements(db, context) {
    return list(db, "orderRefunds").filter(item => active(item) && (
      (context.orderId && item.orderId === context.orderId) || (context.invoiceId && item.invoiceId === context.invoiceId)
    ));
  }

  function cancellationPreview(db, reference) {
    const context = resolveDocument(db, reference), payments = documentPayments(db, context), refunds = settlements(db, context);
    const paid = round(payments.reduce((sum, item) => sum + Number(item.amount || 0), 0));
    const refunded = round(refunds.filter(item => item.settlementType === "cash_refund" || item.settlementType === "linked_disbursement").reduce((sum, item) => sum + Number(item.amount || 0), 0));
    const credited = round(refunds.filter(item => item.settlementType === "customer_credit").reduce((sum, item) => sum + Number(item.amount || 0), 0));
    const pending = round(refunds.filter(item => item.settlementType === "pending_credit").reduce((sum, item) => sum + Number(item.amount || 0), 0));
    const settled = round(refunded + credited), outstanding = round(Math.max(0, paid - settled));
    const candidates = list(db, "receipts").filter(item => active(item) && item.partyKind === "customer" && item.partyId === context.customerId && item.type === "دفع" && !refunds.some(row => row.linkedReceiptId === item.id)).map(item => ({ ...item, difference:round(Math.abs(Number(item.amount || 0) - outstanding)) })).filter(item => item.difference <= Math.max(1, outstanding * 0.05)).sort((a,b) => a.difference - b.difference);
    return { ...context, payments:clone(payments), refunds:clone(refunds), candidates:clone(candidates), total:round(context.invoice?.total ?? context.order?.total ?? 0), paid, refunded, credited, pending, settled, outstanding, canCancel:outstanding === 0 || (pending > 0 && outstanding === pending), pendingCancellation:outstanding > 0 && pending > 0 && outstanding === pending, customerName:context.customer?.name || context.order?.customerName || context.invoice?.customerSnapshot?.name || "—" };
  }

  function createSettlement(db, reference, payload, actor, randomUUID) {
    const preview = cancellationPreview(db, reference), type = String(payload.settlementType || ""), operationKey = String(payload.operationKey || "").trim();
    if (!operationKey) throw Object.assign(new Error("Operation Key مطلوب."), { code:"OPERATION_KEY_REQUIRED", status:400 });
    db.orderRefunds = list(db, "orderRefunds");
    const existing = db.orderRefunds.find(item => item.operationKey === operationKey);
    if (existing) return { settlement:existing, existing:true, preview:cancellationPreview(db, reference) };
    if (!["cash_refund", "customer_credit", "linked_disbursement", "pending_credit"].includes(type)) throw Object.assign(new Error("اختر طريقة تسوية صحيحة."), { code:"INVALID_SETTLEMENT_TYPE", status:400 });
    const amount = round(payload.amount);
    if (!(amount > 0) || amount > preview.outstanding) throw Object.assign(new Error("قيمة التسوية أكبر من المدفوع الصافي أو غير صالحة."), { code:"REFUND_EXCEEDS_NET_PAID", status:409 });
    const paymentId = String(payload.paymentId || preview.payments.find(item => round(item.amount) > 0)?.id || "");
    if (!paymentId) throw Object.assign(new Error("اختر الدفعة الأصلية."), { code:"PAYMENT_REQUIRED", status:400 });
    const payment = preview.payments.find(item => item.id === paymentId);
    if (!payment) throw Object.assign(new Error("الدفعة الأصلية غير موجودة."), { code:"PAYMENT_NOT_FOUND", status:404 });
    const paymentSettled = round(preview.refunds.filter(item => item.paymentId === paymentId).reduce((sum,item) => sum + Number(item.amount || 0), 0));
    if (amount > round(Number(payment.amount || 0) - paymentSettled)) throw Object.assign(new Error("تمت تسوية هذه الدفعة من قبل أو تجاوزت قيمتها."), { code:"DUPLICATE_REFUND", status:409 });
    if (type === "pending_credit" && !String(payload.reason || "").trim()) throw Object.assign(new Error("سبب الرصيد المعلق مطلوب."), { code:"PENDING_REASON_REQUIRED", status:400 });
    let account = null, receipt = null;
    if (type === "cash_refund") {
      account = list(db, "cashAccounts").find(item => !item.deletedAt && item.active !== false && item.id === payload.cashAccountId);
      if (!account) throw Object.assign(new Error("اختر الخزنة التي سيخرج منها الرد."), { code:"CASH_ACCOUNT_REQUIRED", status:400 });
    }
    if (type === "linked_disbursement") {
      receipt = preview.candidates.find(item => item.id === payload.receiptId);
      if (!receipt || round(receipt.amount) !== amount) throw Object.assign(new Error("إيصال الصرف غير صالح للربط أو قيمته لا تطابق التسوية."), { code:"INVALID_DISBURSEMENT_LINK", status:409 });
    }
    const originalCashMovement=list(db,"cash").find(item=>item.paymentId===paymentId||item.receiptId===paymentId),now = new Date().toISOString(), refundId = `RFD-${randomUUID()}`;
    const settlement = { refundId, id:refundId, orderId:preview.orderId || "", invoiceId:preview.invoiceId || "", paymentId, originalCashMovementId:String(payload.originalCashMovementId || originalCashMovement?.id || ""), customerId:preview.customerId, amount, method:type, settlementType:type, cashAccountId:account?.id || "", creditAccount:type === "customer_credit" ? `CUSTOMER-CREDIT:${preview.customerId}` : type === "pending_credit" ? `PENDING-CREDIT:${preview.customerId}` : "", linkedReceiptId:receipt?.id || "", reason:String(payload.reason || "تسوية المبلغ قبل الإلغاء").trim(), performedBy:actor.name || actor.username, performedByUsername:actor.username, performedAt:now, operationKey, status:"confirmed" };
    db.orderRefunds.push(settlement);
    if (type === "cash_refund") {
      db.cash = list(db, "cash");
      db.cash.push({ id:`TX-${randomUUID()}`, date:now.slice(0,10), type:"صرف", direction:"out", locked:true, account:account.name, accountId:account.id, party:preview.customerName, customerId:preview.customerId, amount, category:"رد مبلغ طلب", orderId:preview.orderId, invoiceId:preview.invoiceId, paymentId, refundId, sourceKey:`refund:${refundId}`, note:settlement.reason, createdAt:now, createdBy:settlement.performedBy, status:"معتمد" });
    }
    if (type === "customer_credit" || type === "pending_credit") {
      db.customerCredits = list(db, "customerCredits");
      db.customerCredits.push({ id:`CRD-${randomUUID()}`, customerId:preview.customerId, orderId:preview.orderId, invoiceId:preview.invoiceId, refundId, amount, remainingAmount:amount, type, status:type === "pending_credit" ? "pending" : "available", reason:settlement.reason, createdAt:now, createdBy:settlement.performedBy });
    }
    return { settlement, existing:false, preview:cancellationPreview(db, reference) };
  }

  function useCustomerCredit(db, { customerId, orderId, invoiceId = "", creditId, amount, operationKey }, actor, randomUUID) {
    db.customerCreditUses = list(db, "customerCreditUses");
    const existing = db.customerCreditUses.find(item => item.operationKey === operationKey); if (existing) return { use:existing, existing:true };
    const credit = list(db, "customerCredits").find(item => item.id === creditId && item.customerId === customerId && item.status === "available");
    const value=round(amount);if(!credit||!(value>0)||value>round(credit.remainingAmount))throw Object.assign(new Error("الرصيد الدائن غير كافٍ."),{code:"INSUFFICIENT_CUSTOMER_CREDIT",status:409});
    credit.remainingAmount=round(credit.remainingAmount-value);if(credit.remainingAmount===0)credit.status="used";
    const use={id:`CRU-${randomUUID()}`,customerId,orderId,invoiceId,creditId,amount:value,operationKey,performedBy:actor.name||actor.username,performedAt:new Date().toISOString(),status:"confirmed"};db.customerCreditUses.push(use);return {use,existing:false};
  }

  function customerLedger(db, customerId) {
    const rows=[];
    for(const sale of list(db,"sales").filter(x=>x.customerId===customerId&&!x.deletedAt))rows.push({date:sale.createdAt||sale.date,type:"invoice",reference:sale.id,description:`فاتورة مبيعات${sale.onlineOrderId?` — ${sale.onlineOrderId}`:""}`,debit:sale.status==="ملغاة"?0:round(sale.total),credit:0,status:sale.status||"معتمدة",user:sale.createdByName||sale.createdByUsername||"",links:{invoiceId:sale.id,orderId:sale.onlineOrderId||""}});
    for(const payment of list(db,"orderPayments").filter(x=>x.customerId===customerId&&!x.deletedAt))rows.push({date:payment.receivedAt,type:"payment",reference:payment.id,description:"إيصال استلام / دفع من العميل",debit:0,credit:payment.status==="reversed"?0:round(payment.amount),status:payment.status,user:payment.receivedBy||"",links:{invoiceId:payment.invoiceId||"",orderId:payment.orderId||""}});
    for(const refund of list(db,"orderRefunds").filter(x=>x.customerId===customerId&&!x.deletedAt))rows.push({date:refund.performedAt,type:refund.settlementType,reference:refund.refundId,description:{cash_refund:"رد مبلغ نقدي",customer_credit:"تحويل مدفوعات الطلب إلى رصيد دائن",linked_disbursement:"ربط إيصال صرف برد مبلغ الطلب",pending_credit:"إبقاء المبلغ كرصيد معلق"}[refund.settlementType],debit:["cash_refund","linked_disbursement"].includes(refund.settlementType)?round(refund.amount):0,credit:["customer_credit","pending_credit"].includes(refund.settlementType)?round(refund.amount):0,status:refund.status,user:refund.performedBy,links:{invoiceId:refund.invoiceId,orderId:refund.orderId,receiptId:refund.linkedReceiptId||""}});
    for(const use of list(db,"customerCreditUses").filter(x=>x.customerId===customerId&&!x.deletedAt))rows.push({date:use.performedAt,type:"credit_use",reference:use.id,description:"استخدام رصيد دائن في طلب جديد",debit:round(use.amount),credit:0,status:use.status,user:use.performedBy,links:{invoiceId:use.invoiceId,orderId:use.orderId}});
    for(const order of list(db,"onlineOrders").filter(x=>x.customerId===customerId&&x.status==="ملغي"))rows.push({date:order.cancelledAt,type:"cancelled_order",reference:order.id,description:"إلغاء طلب — إلغاء مستند دون حذف",debit:0,credit:0,status:"ملغي",user:order.cancelledBy||"",links:{orderId:order.id,invoiceId:order.saleId||""}});
    rows.sort((a,b)=>String(a.date).localeCompare(String(b.date)));let balance=0;return rows.map(row=>{balance=round(balance+row.debit-row.credit);return{...row,balance};});
  }

  function repairPreview(db) {
    const groups=new Map();for(const sale of list(db,"sales").filter(x=>x.onlineOrderId&&!x.deletedAt&&x.status!=="ملغاة")){const rows=groups.get(sale.onlineOrderId)||[];rows.push(sale);groups.set(sale.onlineOrderId,rows);}
    const duplicateInvoices=[...groups].filter(([,rows])=>rows.length>1).map(([orderId,rows])=>({orderId,canonicalInvoiceId:rows.slice().sort((a,b)=>String(a.createdAt||a.date).localeCompare(String(b.createdAt||b.date)))[0].id,duplicateInvoiceIds:rows.slice(1).map(x=>x.id)}));
    const keys=new Map();for(const p of list(db,"orderPayments").filter(active)){const key=String(p.idempotencyKey||p.sourceKey||p.id);const rows=keys.get(key)||[];rows.push(p);keys.set(key,rows);}const duplicatePayments=[...keys].filter(([,rows])=>rows.length>1).map(([key,rows])=>({key,paymentIds:rows.map(x=>x.id),orderIds:[...new Set(rows.map(x=>x.orderId).filter(Boolean))]}));
    const blockedOrders=list(db,"onlineOrders").filter(x=>!x.deletedAt&&cancellationPreview(db,{orderId:x.id}).outstanding>0).map(x=>{const p=cancellationPreview(db,{orderId:x.id});return{orderId:x.id,invoiceId:p.invoiceId,customerId:p.customerId,paid:p.paid,outstanding:p.outstanding,potentialDisbursementIds:p.candidates.map(r=>r.id),proposal:p.candidates.length?"link manual refund after approval":"cash refund or customer credit"};});
    return {dryRun:true,duplicateInvoices,duplicatePayments,blockedOrders,proposedActions:duplicateInvoices.map(x=>({orderId:x.orderId,keepCanonicalInvoice:x.canonicalInvoiceId,voidDuplicateInvoices:x.duplicateInvoiceIds,reverseDuplicatePayment:"only after explicit approval"}))};
  }

  return { round, resolveDocument, documentPayments, cancellationPreview, createSettlement, useCustomerCredit, customerLedger, repairPreview };
});
