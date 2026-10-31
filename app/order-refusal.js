(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const refunds = node ? require("./order-refund.js") : root.OrderRefunds;
  const integrity = node ? require("./purchase-inventory-integrity.js") : root.PurchaseInventoryIntegrity;
  const api = factory(refunds, integrity);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrderRefusals = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Refunds, Integrity) {
  "use strict";
  // Business dates are Cairo dates: work between midnight and 2–3 am belongs to the new day, not the UTC one.
  const cairoDate = (value = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));


  // A refused delivery is not a customer return: the customer never received the books, so the whole invoice is
  // reversed and the only money left to settle is the deposit and the shipping cost the customer is asked to cover.
  //   refund_deposit  — our mistake: the deposit goes back from a cash account, the customer ends at zero.
  //   keep_deposit    — the deposit is kept as shipping compensation, the customer ends at zero.
  //   charge_shipping — the customer is told the shipping cost; the deposit covers part of it and the rest is owed.
  const OUTCOMES = {
    refund_deposit: "رد الديبوزت للعميل",
    keep_deposit: "الاحتفاظ بالديبوزت كتعويض شحن",
    charge_shipping: "العميل يكمّل تكلفة الشحن"
  };

  const round = Refunds.round;
  const list = (db, key) => Array.isArray(db?.[key]) ? db[key] : [];
  const fail = (message, code, status = 409) => Object.assign(new Error(message), { code, status });

  function nextNumber(prefix, rows, pad = 4) {
    const max = rows.reduce((acc, item) => {
      const number = Number(String(item.id || "").replace(/\D/g, ""));
      return Number.isSafeInteger(number) ? Math.max(acc, number) : acc;
    }, 0);
    return `${prefix}${String(max + 1).padStart(pad, "0")}`;
  }

  function nextReturnNo(db) {
    const max = list(db, "returns").reduce((acc, item) => {
      const value = String(item.returnNo || item.returnInvoiceId || item.id || "");
      return value.startsWith("SR-") ? Math.max(acc, Number(value.replace(/\D/g, "")) || 1000) : acc;
    }, 1000);
    return `SR-${max + 1}`;
  }

  function saleReturns(db, saleId) {
    return list(db, "returns").filter(item => !item.deletedAt && ["sale", "sales_return"].includes(item.type) && (item.documentId === saleId || (item.sourceDocuments || []).includes(saleId)));
  }

  // The deposit is whatever was paid on the order and not already given back; a refusal never touches more than that.
  function depositSummary(db, orderId, invoiceId) {
    const context = Refunds.resolveDocument(db, { orderId, invoiceId });
    const payments = Refunds.documentPayments(db, context);
    const settled = list(db, "orderRefunds").filter(item => !item.deletedAt && item.status !== "reversed" && (item.orderId === context.orderId || (context.invoiceId && item.invoiceId === context.invoiceId)));
    const rows = payments.map(payment => ({
      payment,
      open: round(Number(payment.amount || 0) - settled.filter(row => row.paymentId === payment.id).reduce((sum, row) => sum + Number(row.amount || 0), 0))
    })).filter(row => row.open > 0);
    return { context, rows, deposit: round(rows.reduce((sum, row) => sum + row.open, 0)) };
  }

  function shipmentDelivered(shipment) {
    const codes = [shipment.normalizedStatus, shipment.shippingStatus, shipment.trackingStatus].map(value => String(value || ""));
    return codes.includes("delivered") || shipment.status === "تم التسليم" || shipment.currentStatus === "تم التسليم";
  }

  function refusalPreview(db, orderId) {
    const order = list(db, "onlineOrders").find(item => !item.deletedAt && item.id === orderId);
    if (!order) throw fail("الطلب غير موجود.", "ORDER_NOT_FOUND", 404);
    const sale = list(db, "sales").find(item => !item.deletedAt && (item.id === order.saleId || item.onlineOrderId === order.id) && item.status !== "ملغاة") || null;
    const shipment = list(db, "shipments").find(item => !item.deletedAt && !item.cancelledAt && (item.id === order.shipmentId || item.onlineOrderId === order.id)) || null;
    const customer = list(db, "customers").find(item => !item.deletedAt && item.id === (order.customerId || sale?.customerId)) || null;
    let blocked = "";
    if (order.refusal) blocked = "تم تسجيل رفض الاستلام لهذا الطلب من قبل.";
    else if (order.cancelledAt || order.status === "ملغي") blocked = "الطلب ملغي.";
    else if (!sale) blocked = "لا توجد فاتورة لهذا الطلب؛ استخدم إلغاء الطلب بدل رفض الاستلام.";
    else if (!shipment && !order.shipmentId) blocked = "الطلب لم يُشحن بعد؛ استخدم إلغاء الطلب بدل رفض الاستلام.";
    else if (["مرتجع", "مرتجع جزئي"].includes(sale.status) || saleReturns(db, sale.id).length) blocked = "الفاتورة عليها مرتجع مسجل بالفعل؛ استخدم أداة تصحيح المرتجعات القديمة.";
    // A parcel the customer received, or whose money the carrier collected or settled, was not refused: that is a
    // return (with its own refund), not a refusal that puts the books back and leaves the collected money standing.
    else if (shipment && shipmentDelivered(shipment)) blocked = "الشحنة اتسلمت للعميل؛ سجّلها مرتجع عادي مش رفض استلام.";
    else if (shipment && (shipment.settlementId || list(db, "orderCollections").some(item => item.sourceKey === `order-collection:${shipment.id}` && item.status !== "reversed"))) blocked = "شركة الشحن حصّلت فلوس الشحنة دي؛ اعكس التحصيل الأول أو سجّلها مرتجع عادي.";
    const { deposit } = sale ? depositSummary(db, order.id, sale.id) : { deposit: 0 };
    return {
      orderId: order.id, invoiceId: sale?.id || "", shipmentId: shipment?.id || "", trackingNumber: shipment?.trackingNumber || shipment?.tracking || "",
      customerId: customer?.id || order.customerId || "", customerName: customer?.name || order.customerName || "",
      total: round(sale?.total ?? order.total ?? 0), shippingFee: round(sale?.shippingFee ?? sale?.shipping ?? order.shippingCost ?? 0),
      deposit, codRemaining: round(sale?.remaining ?? 0),
      depositCashAccountId: (sale ? Refunds.documentPayments(db, Refunds.resolveDocument(db, { orderId: order.id, invoiceId: sale.id })) : []).find(item => item.cashAccountId)?.cashAccountId || "",
      carrier: shipment ? { postal: isPostalShipment(shipment), name: shipment.carrier || shipment.company || "", expectedCost: round(shipment.postalCostQuote?.totalCost ?? shipment.carrierShippingCostExpected ?? shipment.cost ?? 0) } : null,
      canRefuse: !blocked, blocked, outcomes: OUTCOMES
    };
  }

  // Effect of each outcome on the money, given the deposit still held. `shippingCharge` is the full amount the
  // customer was told to pay for the failed shipment (charge_shipping only).
  function settlementPlan(deposit, outcome, shippingCharge = 0) {
    if (!OUTCOMES[outcome]) throw fail("اختر حالة رفض الاستلام.", "INVALID_REFUSAL_OUTCOME", 400);
    if (outcome === "refund_deposit") return { outcome, refund: round(deposit), retained: 0, extraDue: 0, fee: 0 };
    if (outcome === "keep_deposit") return { outcome, refund: 0, retained: round(deposit), extraDue: 0, fee: round(deposit) };
    const charge = round(Refunds.round(shippingCharge));
    if (!(charge > 0)) throw fail("اكتب تكلفة الشحن المطلوبة من العميل.", "SHIPPING_CHARGE_REQUIRED", 400);
    if (charge <= deposit) throw fail(`تكلفة الشحن (${charge}) لا تزيد عن الديبوزت (${deposit})؛ اختر «الاحتفاظ بالديبوزت» بدلًا منها.`, "SHIPPING_CHARGE_NOT_ABOVE_DEPOSIT", 400);
    return { outcome, refund: 0, retained: round(deposit), extraDue: round(charge - deposit), fee: charge };
  }

  const isPostalShipment = shipment => Boolean(shipment?.postalBillingManaged) || /البريد المصري|egypt\s*post|EGYPT_POST/i.test(`${shipment?.carrier || ""} ${shipment?.company || ""} ${shipment?.carrierCode || ""}`);

  // What the carrier bills for a parcel that came back: whether it still charges the original shipping, and any return
  // fee. Egypt Post costs reach the books through the monthly postal statement, so they are recorded on the shipment
  // (charge status, and the fee in the month it was charged); other carriers deduct their cost in the collection
  // settlement, so their expected cost is adjusted. Answers can be corrected later until the month's statement closes.
  // Throws, without changing anything, when the answer cannot be recorded.
  function checkCarrierCharges(db, shipment, { charged, returnFee } = {}, now) {
    const fee = round(returnFee);
    if (!Number.isFinite(fee) || fee < 0) throw fail("رسوم المرتجع غير صالحة.", "INVALID_RETURN_FEE", 400);
    if (!["yes", "no"].includes(charged)) throw fail("حدد هل شركة الشحن حسبت تكلفة الشحنة.", "CARRIER_CHARGE_REQUIRED", 400);
    if (!isPostalShipment(shipment)) return fee;
    const closed = month => list(db, "postalStatements").some(item => !item.deletedAt && item.month === month);
    const shippedMonth = String(shipment.shippedAt || shipment.createdAt || "").slice(0, 7);
    const feeMonth = shipment.carrierReturnFeeMonth || cairoDate(now).slice(0, 7);
    if ((charged === "no" ? "not_charged" : "charged") !== (shipment.postalChargeStatus || "charged") && closed(shippedMonth)) throw fail(`كشف البريد لشهر ${shippedMonth} معتمد؛ تكلفة الشحنة اتحسبت فيه ومينفعش تتغير.`, "POSTAL_MONTH_CLOSED");
    if (fee !== round(shipment.carrierReturnFee || 0) && round(shipment.carrierReturnFee || 0) > 0 && closed(feeMonth)) throw fail(`كشف البريد لشهر ${feeMonth} معتمد؛ رسوم المرتجع اتحسبت فيه ومينفعش تتغير.`, "POSTAL_MONTH_CLOSED");
    return fee;
  }

  function applyCarrierCharges(db, shipment, { charged, returnFee, reason = "" } = {}, actor, now) {
    if (!shipment) return null;
    const fee = checkCarrierCharges(db, shipment, { charged, returnFee }, now);
    const postal = isPostalShipment(shipment);
    if (postal) {
      const nextStatus = charged === "no" ? "not_charged" : "charged";
      Object.assign(shipment, { postalChargeStatus: nextStatus, postalChargeReason: nextStatus === "not_charged" ? (reason || "رفض استلام") : "", postalChargeRecordedAt: now, postalChargeRecordedBy: actor.name || actor.username });
    } else {
      // The settlement deducts the expected cost: the original shipping (unless waived) plus the return fee.
      const base = shipment.carrierBaseCost ?? round(shipment.carrierShippingCostExpected ?? shipment.cost ?? 0);
      Object.assign(shipment, { carrierBaseCost: base, carrierShippingCostExpected: round((charged === "no" ? 0 : base) + fee) });
    }
    Object.assign(shipment, {
      carrierCharged: charged === "yes", carrierReturnFee: fee, carrierReturnFeeMonth: fee > 0 ? (shipment.carrierReturnFeeMonth && round(shipment.carrierReturnFee || 0) > 0 ? shipment.carrierReturnFeeMonth : cairoDate(now).slice(0, 7)) : "",
      carrierChargesRecordedAt: now, carrierChargesRecordedBy: actor.name || actor.username, updatedAt: now
    });
    return { postal, charged: charged === "yes", returnFee: fee };
  }

  function restockSale(db, sale, actor, note, now) {
    for (const line of sale.lines || []) {
      const qty = Number(line.qty ?? line.quantity ?? 0), book = list(db, "books").find(item => item.id === (line.bookId || line.productId));
      if (!book || !(qty > 0)) continue;
      const before = Number(book.stock || 0);
      book.stock = before + qty;
      book.updatedAt = now;
      db.stockMovements = list(db, "stockMovements");
      db.stockMovements.push({ id: `MOV-${actor.uuid()}`, bookId: book.id, date: now, createdAt: now, type: "مرتجع مبيعات - رفض استلام", quantity: qty, before, after: book.stock, documentId: sale.id, note, user: actor.name || actor.username, username: actor.username });
      Integrity.restoreSaleLineToBatches(db, sale, line, qty, { now, source:"refusal_return" });
    }
  }

  // Refunds the open deposit in cash, or marks it as kept, payment by payment so the order's settlement history
  // (and the cancellation check) sees the deposit as fully settled.
  function settleDeposit(db, orderId, invoiceId, plan, { cashAccountId, operationKey, reason, refusalId }, actor) {
    const { rows } = depositSummary(db, orderId, invoiceId), created = [];
    if (!(plan.refund > 0 || plan.retained > 0)) return created;
    const type = plan.refund > 0 ? "cash_refund" : "retained_fee";
    for (const { payment, open } of rows) {
      const result = Refunds.createSettlement(db, { orderId, invoiceId }, { settlementType: type, amount: open, paymentId: payment.id, cashAccountId: cashAccountId || payment.cashAccountId || "", operationKey: `${operationKey}:${type}:${payment.id}`, reason }, actor, actor.uuid);
      result.settlement.refusalId = refusalId;
      const tx = list(db, "cash").find(item => item.refundId === result.settlement.refundId);
      if (tx) { tx.category = "مرتجع مبيعات - رفض استلام"; tx.refusalId = refusalId; }
      created.push(result.settlement);
    }
    return created;
  }

  function applyRefusal(db, orderId, payload = {}, actor) {
    const operationKey = String(payload.operationKey || "").trim();
    if (!operationKey) throw fail("Operation Key مطلوب.", "OPERATION_KEY_REQUIRED", 400);
    const done = list(db, "onlineOrders").find(item => item.refusal?.operationKey === operationKey);
    if (done) return { existing: true, order: done, refusal: done.refusal };
    const preview = refusalPreview(db, orderId);
    if (!preview.canRefuse) throw fail(preview.blocked, "REFUSAL_NOT_ALLOWED");
    const plan = settlementPlan(preview.deposit, payload.outcome, payload.shippingCharge);
    const refusedShipment = preview.shipmentId ? list(db, "shipments").find(item => item.id === preview.shipmentId) : null;
    if (refusedShipment) checkCarrierCharges(db, refusedShipment, { charged: payload.carrierCharged, returnFee: payload.carrierReturnFee || 0 }, actor.now || new Date().toISOString());
    if (plan.refund > 0 && !list(db, "cashAccounts").some(item => !item.deletedAt && item.active !== false && item.id === (payload.cashAccountId || preview.depositCashAccountId))) throw fail("اختر الخزنة التي سيُرد منها الديبوزت.", "CASH_ACCOUNT_REQUIRED", 400);
    const now = actor.now || new Date().toISOString(), date = payload.date ? String(payload.date).slice(0, 10) : cairoDate(now);
    const order = list(db, "onlineOrders").find(item => item.id === orderId);
    const sale = list(db, "sales").find(item => item.id === preview.invoiceId);
    const customer = list(db, "customers").find(item => item.id === sale.customerId);
    const note = String(payload.note || "").trim();
    const reason = [`رفض استلام الطلب ${order.id}`, OUTCOMES[plan.outcome], note].filter(Boolean).join(" — ");
    db.returns = list(db, "returns");
    const returnId = nextNumber("RET-", db.returns), returnNo = nextReturnNo(db), refusalId = returnId;

    restockSale(db, sale, actor, reason, now);
    const settlements = settleDeposit(db, order.id, sale.id, plan, { cashAccountId: payload.cashAccountId || preview.depositCashAccountId, operationKey, reason, refusalId }, actor);

    // The cash-on-delivery amount was never collected, so it leaves the customer's balance completely; only the
    // part of the shipping charge above the deposit stays owed, carried on the invoice so receipts can settle it.
    const codRemaining = round(sale.remaining ?? 0);
    if (customer) customer.balance = round(Number(customer.balance || 0) - codRemaining + plan.extraDue);
    const refusal = { id: refusalId, returnId, returnNo, outcome: plan.outcome, outcomeLabel: OUTCOMES[plan.outcome], deposit: preview.deposit, refund: plan.refund, retained: plan.retained, shippingCharge: plan.fee, extraDue: plan.extraDue, codRemaining, note, reason, operationKey, settlementIds: settlements.map(item => item.refundId), at: now, by: actor.name || actor.username, byUsername: actor.username };
    Object.assign(sale, {
      status: "مرتجع", refusal,
      returnedRemaining: round(Number(sale.returnedRemaining || 0) + codRemaining), remaining: plan.extraDue, remainingAmount: plan.extraDue,
      returnedPaid: round(Number(sale.returnedPaid || 0) + plan.refund), paid: round(Math.max(0, Number(sale.paid || 0) - plan.refund)), paidAmount: round(Math.max(0, Number(sale.paid || 0) - plan.refund)),
      returnedAt: now, returnReason: reason, updatedAt: now
    });
    db.returns.push({
      id: returnId, returnNo, returnInvoiceId: returnNo, type: "sales_return", mode: "refusal", refusalOutcome: plan.outcome,
      accountType: "customer", accountId: sale.customerId, partyId: sale.customerId, documentId: sale.id, sourceDocuments: [sale.id], onlineOrderId: order.id,
      date, items: (sale.lines || []).map((line, index) => ({ bookId: line.bookId || line.productId, sourceInvoiceId: sale.id, sourceInvoiceNo: sale.id, lineIndex: index, qty: Number(line.qty ?? line.quantity ?? 0), unitPrice: Number(line.finalUnitPrice ?? line.price ?? 0), total: Number(line.finalNet ?? line.lineTotal ?? 0), reason })),
      // Sales reports subtract `subtotal`: the whole invoice is reversed except the shipping charge the customer bears.
      subtotal: round(Number(sale.total || 0) - plan.fee), amount: round(Number(sale.total || 0) - plan.fee),
      debtReduction: codRemaining, replacementDeduction: 0, customerDue: plan.refund, refusalFee: plan.fee, refusalExtraDue: plan.extraDue,
      settlementType: plan.refund > 0 ? "cash" : "refusal", settlement: plan.refund > 0 ? "cash" : "refusal", paidAmount: plan.refund,
      balanceEffect: round(plan.extraDue - codRemaining), account: plan.refund > 0 ? (list(db, "cashAccounts").find(item => item.id === (payload.cashAccountId || preview.depositCashAccountId))?.name || "") : "",
      reason, notes: note, lines: [], createdBy: actor.name || actor.username || "النظام", createdAt: now, updatedAt: now, status: "معتمد", deletedAt: null
    });
    const shipment = list(db, "shipments").find(item => item.id === preview.shipmentId);
    const carrier = shipment ? applyCarrierCharges(db, shipment, { charged: payload.carrierCharged, returnFee: payload.carrierReturnFee || 0, reason }, actor, now) : null;
    if (carrier) Object.assign(refusal, { carrierCharged: carrier.charged, carrierReturnFee: carrier.returnFee });
    // Tracking reads the normalized status, so it has to say returned too or the parcel keeps being tracked.
    if (shipment) Object.assign(shipment, { status: "مرتجع", currentStatus: "مرتجع", normalizedStatus: "returned", shippingStatus: "returned", refusedAt: now, returnedAt: shipment.returnedAt || now, updated: now, updatedAt: now });
    // The order list shows the order's own paid / remaining figures, so they follow the refusal too.
    Object.assign(order, { status: "مرتجع", workflowStage: "returned", refusal, refusedAt: now, returnedAt: order.returnedAt || now, paidAmount: round(preview.deposit - plan.refund), remainingAmount: plan.extraDue, remaining: plan.extraDue, updatedAt: now });
    return { existing: false, order, sale, refusal, settlements };
  }

  // --- Repair of returns recorded before this flow existed -------------------------------------------------------
  // A fully returned online-order invoice whose generic return left the customer with credit (or with part of the
  // cash-on-delivery amount still owed) is listed with what the order currently adds to the customer's balance.
  function repairCandidates(db) {
    const rows = [];
    for (const sale of list(db, "sales")) {
      if (sale.deletedAt || !sale.onlineOrderId || sale.status !== "مرتجع" || sale.refusal || sale.refusalRepair) continue;
      const returns = saleReturns(db, sale.id);
      if (!returns.length || returns.some(item => item.mode === "refusal" || (item.sourceDocuments || [sale.id]).length > 1)) continue;
      const order = list(db, "onlineOrders").find(item => item.id === sale.onlineOrderId) || {};
      const customer = list(db, "customers").find(item => item.id === sale.customerId);
      const originalRemaining = round(Number(sale.remaining || 0) + Number(sale.returnedRemaining || 0));
      const balanceEffect = round(returns.reduce((sum, item) => sum + Number(item.balanceEffect || 0), 0));
      const contribution = round(originalRemaining + balanceEffect);
      const cashRefunded = round(returns.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0));
      // The old return moved part of the deposit from `paid` to `returnedPaid`; together they are what was paid.
      const deposit = round(Number(sale.paid || 0) + Number(sale.returnedPaid || 0));
      if (contribution === 0 && cashRefunded === 0) continue;
      rows.push({
        invoiceId: sale.id, orderId: sale.onlineOrderId, customerId: sale.customerId, customerName: customer?.name || order.customerName || "—",
        customerBalance: round(customer?.balance || 0), total: round(sale.total || 0), deposit, cashRefunded, contribution,
        returnIds: returns.map(item => item.returnNo || item.id), returnedAt: sale.returnedAt || returns[0]?.date || "",
        // "Cash refund" was the return screen's default, so a recorded payout may never have left the cash box; the
        // employee says which, and only a payout that really happened limits the outcome to refunding the deposit.
        allowedOutcomes: Object.keys(OUTCOMES)
      });
    }
    return rows.sort((a, b) => String(b.returnedAt).localeCompare(String(a.returnedAt)));
  }

  function applyRepair(db, invoiceId, payload = {}, actor) {
    const operationKey = String(payload.operationKey || "").trim();
    if (!operationKey) throw fail("Operation Key مطلوب.", "OPERATION_KEY_REQUIRED", 400);
    const already = list(db, "sales").find(item => item.refusalRepair?.operationKey === operationKey);
    if (already) return { existing: true, sale: already, repair: already.refusalRepair };
    const row = repairCandidates(db).find(item => item.invoiceId === invoiceId);
    if (!row) throw fail("هذه الفاتورة لا تحتاج تصحيح أو تم تصحيحها من قبل.", "REPAIR_NOT_NEEDED");
    const plan = settlementPlan(row.deposit, payload.outcome, payload.shippingCharge);
    const cashNotPaid = row.cashRefunded > 0 && payload.cashNotPaid === true;
    const cashPaid = cashNotPaid ? 0 : row.cashRefunded;
    if (plan.refund < cashPaid) throw fail(`اتسجل إن العميل استلم ${cashPaid} كاش. لو ده حصل فعلًا اختار «رد الديبوزت»، ولو ما اتصرفش علّم إن المبلغ ما اتصرفش.`, "CASH_ALREADY_REFUNDED", 400);
    const extraRefund = round(Math.max(0, plan.refund - cashPaid));
    const account = list(db, "cashAccounts").find(item => !item.deletedAt && item.active !== false && item.id === payload.cashAccountId);
    if (extraRefund > 0 && !account) throw fail("اختر الخزنة التي سيُرد منها باقي الديبوزت.", "CASH_ACCOUNT_REQUIRED", 400);
    const now = actor.now || new Date().toISOString();
    const sale = list(db, "sales").find(item => item.id === invoiceId), customer = list(db, "customers").find(item => item.id === sale.customerId);
    const order = list(db, "onlineOrders").find(item => item.id === sale.onlineOrderId);
    const delta = round(plan.extraDue - row.contribution);
    const reason = [`تصحيح مرتجع رفض استلام ${sale.onlineOrderId}`, OUTCOMES[plan.outcome], String(payload.note || "").trim()].filter(Boolean).join(" — ");
    if (customer) customer.balance = round(Number(customer.balance || 0) + delta);
    if (extraRefund > 0) {
      db.cash = list(db, "cash");
      db.cash.push({ id: nextNumber("TX-", db.cash), date: cairoDate(now), type: "صرف", direction: "out", locked: true, account: account.name, accountId: account.id, party: row.customerName, customerId: sale.customerId, amount: extraRefund, category: "مرتجع مبيعات - رفض استلام", orderId: sale.onlineOrderId, invoiceId: sale.id, sourceKey: `refusal-repair:${operationKey}`, note: reason, createdAt: now, createdBy: actor.name || actor.username, status: "معتمد" });
    }
    // A payout that never happened is cancelled by an opposite cash entry, so the cash box history stays complete.
    let reversedCash = 0;
    if (cashNotPaid) {
      const returns = saleReturns(db, sale.id), returnIds = new Set(returns.map(item => item.id));
      db.cash = list(db, "cash");
      for (const tx of db.cash.filter(item => !item.deletedAt && item.type === "صرف" && returnIds.has(item.returnId) && !item.reversedBy)) {
        const reversal = { id: nextNumber("TX-", db.cash), date: cairoDate(now), type: "قبض", direction: "in", locked: true, account: tx.account, accountId: tx.accountId || "", party: tx.party || row.customerName, customerId: sale.customerId, amount: round(tx.amount), category: "عكس مرتجع مبيعات لم يُصرف", returnId: tx.returnId, reversesId: tx.id, orderId: sale.onlineOrderId, invoiceId: sale.id, sourceKey: `refusal-repair:${operationKey}:reverse:${tx.id}`, note: `المبلغ المسجل رد نقدي في ${tx.id} لم يُصرف للعميل — ${reason}`, createdAt: now, createdBy: actor.name || actor.username, status: "معتمد" };
        db.cash.push(reversal);
        tx.reversedBy = reversal.id;
        reversedCash = round(reversedCash + Number(tx.amount || 0));
      }
      for (const item of returns) if (Number(item.paidAmount || 0) > 0) Object.assign(item, { cashNotPaid: round(item.paidAmount), paidAmount: 0 });
    }
    const repair = { outcome: plan.outcome, outcomeLabel: OUTCOMES[plan.outcome], deposit: row.deposit, refund: plan.refund, extraRefund, reversedCash, retained: plan.retained, shippingCharge: plan.fee, extraDue: plan.extraDue, previousContribution: row.contribution, balanceDelta: delta, reason, operationKey, at: now, by: actor.name || actor.username, byUsername: actor.username };
    Object.assign(sale, { refusalRepair: repair, returnedRemaining: round(Number(sale.returnedRemaining || 0) + Number(sale.remaining || 0)), remaining: plan.extraDue, remainingAmount: plan.extraDue, returnedPaid: plan.refund, paid: round(row.deposit - plan.refund), updatedAt: now });
    const repairedReturns = saleReturns(db, sale.id);
    for (const item of repairedReturns) Object.assign(item, { refusalRepaired: true, updatedAt: now });
    // Reports count cash refunds from the return records, so the deposit paid out now belongs to them too.
    if (extraRefund > 0 && repairedReturns.length) { const last = repairedReturns.at(-1); last.paidAmount = round(Number(last.paidAmount || 0) + extraRefund); }
    // The parcel came back refused too: refusedAt keeps tracking from flipping the order again.
    const repairedShipment = order && list(db, "shipments").find(item => !item.deletedAt && !item.cancelledAt && (item.id === order.shipmentId || item.onlineOrderId === order.id));
    if (repairedShipment && !repairedShipment.refusedAt) Object.assign(repairedShipment, { status: "مرتجع", currentStatus: "مرتجع", normalizedStatus: "returned", shippingStatus: "returned", refusedAt: order.refusedAt || sale.returnedAt || now, updated: now, updatedAt: now });
    if (order) Object.assign(order, { ...(order.refusal ? {} : { refusal: { ...repair, repaired: true } }), status: "مرتجع", workflowStage: "returned", refusedAt: order.refusedAt || sale.returnedAt || now, paidAmount: round(row.deposit - plan.refund), remainingAmount: plan.extraDue, remaining: plan.extraDue, updatedAt: now });
    return { existing: false, sale, repair };
  }

  // Corrects the carrier charges of a refused parcel once the carrier's statement shows what it really billed.
  function updateCarrierCharges(db, orderId, payload = {}, actor) {
    const order = list(db, "onlineOrders").find(item => !item.deletedAt && item.id === orderId);
    if (!order) throw fail("الطلب غير موجود.", "ORDER_NOT_FOUND", 404);
    if (!order.refusal) throw fail("تكلفة شركة الشحن بتتعدل هنا للطلبات المسجل عليها رفض استلام بس.", "ORDER_NOT_REFUSED");
    const shipment = list(db, "shipments").find(item => !item.deletedAt && (item.id === order.shipmentId || item.onlineOrderId === order.id));
    if (!shipment) throw fail("الطلب ملوش شحنة.", "SHIPMENT_NOT_FOUND", 404);
    const now = actor.now || new Date().toISOString();
    const carrier = applyCarrierCharges(db, shipment, { charged: payload.carrierCharged, returnFee: payload.carrierReturnFee || 0, reason: String(payload.note || order.refusal.reason || "").trim() }, actor, now);
    Object.assign(order.refusal, { carrierCharged: carrier.charged, carrierReturnFee: carrier.returnFee });
    order.updatedAt = now;
    return { order, shipment, carrier };
  }

  return { OUTCOMES, refusalPreview, settlementPlan, applyRefusal, repairCandidates, applyRepair, applyCarrierCharges, updateCarrierCharges, isPostalShipment };
});
