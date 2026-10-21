"use strict";

// Website (Store) orders inside the Sales System: catalog/links snapshots for the Store, the approval preview and the
// atomic approval itself (INTEGRATION_DOCS/ARCHITECTURE_TO_BE.md §7). Everything here is synchronous and works on a
// DB snapshot the caller read; the caller writes it back with expectedRevision. Business rules that already exist in
// server-node.js (reservation, backorder stage, quick-order payment, audit, ids, carriers, permissions) are injected,
// never re-implemented.
const crypto = require("crypto");
const OrderFinance = require("./order-finance.js");
const { maskPhone } = require("./chatwood-context.js");

const WEBSITE_ORDER_NUMBER_PATTERN = /^MK\d{6}-\d{5}$/;
const DEPOSIT_DEFAULT = 100;
const DEPOSIT_MAX = 10000;
const DUPLICATE_SENDER_WINDOW_MS = 24 * 60 * 60 * 1000;
const round = OrderFinance.round;

function websiteError(status, code, message, details = {}) {
  return Object.assign(new Error(message), { status, code, details });
}

function asciiDigits(value) {
  return String(value ?? "").replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
}

// Transfer references are compared without spaces, dashes or case ("tx-12 3" === "TX123"). Very short values are
// too weak to call a duplicate and are ignored for detection.
function normalizeTransferReference(value) {
  const normalized = asciiDigits(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized.length >= 4 ? normalized : "";
}

function depositDefault(db) {
  const value = Number(db?.settings?.websiteOrders?.depositDefault);
  return Number.isFinite(value) && value >= 0 && value <= DEPOSIT_MAX ? round(value) : DEPOSIT_DEFAULT;
}

function parseDepositDefault(value) {
  const amount = OrderFinance.normalizeNumber(value);
  if (value === "" || value == null || !Number.isFinite(amount) || amount < 0 || amount > DEPOSIT_MAX) throw websiteError(400, "DEPOSIT_DEFAULT_INVALID", `العربون الافتراضي يجب أن يكون رقمًا من 0 إلى ${DEPOSIT_MAX} ج.م.`);
  return round(amount);
}

function isCancelled(order = {}) {
  return Boolean(order.deletedAt) || order.workflowStage === "cancelled" || ["ملغي", "cancelled", "canceled"].includes(String(order.status || "").toLowerCase());
}

function latestIso(...values) {
  const times = values.map(value => Date.parse(value || "")).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

function createWebsiteOrders(deps) {
  const { normalizeCustomerPhone, availableStock, reserveOrderInventory, applyBackorderStage, applyQuickOrderPayment, appendOrderAudit, nextId, orderShippingCompany, canOrderAction, shipmentStatusLabel = value => value, splitShipment = null } = deps;

  function normalizeEgyptPhone(value) {
    let digits = normalizeCustomerPhone(asciiDigits(value));
    if (digits.startsWith("0020") && digits.length === 14) digits = `0${digits.slice(4)}`;
    if (/^1\d{9}$/.test(digits)) digits = `0${digits}`;
    return /^01\d{9}$/.test(digits) ? digits : "";
  }

  function orderShipment(db, order) {
    const shipments = (db.shipments || []).filter(item => !item.deletedAt && (item.id === order.shipmentId || item.onlineOrderId === order.id));
    return shipments.find(item => !item.cancelledAt && item.shippingStatus !== "cancelled") || shipments[0] || null;
  }

  function shipmentSummary(shipment) {
    if (!shipment) return null;
    const status = String(shipment.normalizedStatus || shipment.shippingStatus || (shipment.cancelledAt ? "cancelled" : "") || "shipped");
    return { id:shipment.id, trackingNumber:shipment.trackingNumber || shipment.tracking || "", status, statusLabel:shipmentStatusLabel(status, shipment.currentStatus || shipment.status || ""), carrier:shipment.company || shipment.carrier || "" };
  }

  // §2.1: no cost, supplier or purchase fields — only what the Store needs to price and show availability.
  function catalogSnapshot(db, revision, now = new Date()) {
    const books = (db.books || []).filter(book => book && typeof book.id === "string" && book.id).map(book => ({
      id:book.id, name:String(book.name || ""), barcode:String(book.barcode || ""), extraBarcode:String(book.extraBarcode || ""), sku:String(book.sku || ""),
      price:round(Number(book.price || 0)), stock:Number(book.stock || 0), reservedStock:Math.max(0, Number(book.reservedStock || 0)), countHoldQty:Math.max(0, Number(book.countHoldQty || 0)),
      available:availableStock(book), allowPreorder:book.allowPreorder === true, deleted:Boolean(book.deletedAt), updatedAt:book.updatedAt || null
    }));
    return { ok:true, revision:String(revision), generatedAt:now.toISOString(), settings:{ websiteDepositDefault:depositDefault(db) }, books };
  }

  function remainingOf(order) {
    const total = round(Number(order.total || 0)), paid = round(Number(order.paidAmount || 0));
    return Number.isFinite(Number(order.remainingAmount)) && order.remainingAmount !== "" && order.remainingAmount != null ? round(Number(order.remainingAmount)) : round(Math.max(0, total - paid));
  }

  // Partial shipping: each part of a split website order with its own stage, totals and shipment (part 1 first).
  function linkParts(db, order) {
    const parts = splitShipment ? splitShipment.parts(db, order) : [];
    return parts.map((part, index) => {
      const shipment = orderShipment(db, part);
      return {
        part:index + 1, salesOrderId:part.id, workflowStage:part.workflowStage || "draft", status:part.status || "", cancelled:isCancelled(part),
        total:round(Number(part.total || 0)), shippingFee:round(Number(part.shippingFee ?? part.shippingCost ?? 0)), paidAmount:round(Number(part.paidAmount || 0)), remainingAmount:remainingOf(part),
        lines:(part.lines || []).map(line => ({ bookId:line.bookId, qty:Number(line.qty || 0), websiteProductId:line.websiteProductId ?? null })),
        shipment:shipmentSummary(shipment), updatedAt:latestIso(part.updatedAt, part.createdAt, shipment?.updatedAt, shipment?.lastTrackedAt)
      };
    });
  }

  // Required deposit of a System order (the per-order value, else the approval snapshot); null when none was set.
  function depositRequiredOf(order) {
    const value = order.depositRequired ?? order.deposit?.required;
    return value === undefined || value === null || value === "" || !Number.isFinite(Number(value)) ? null : round(Number(value));
  }

  // After an employee edited a website order on the customer's request, the link carries its books and totals so the
  // Store can show them on the customer's order page. Not sent for a split order (its parts carry their own lines).
  function orderEdit(db, order, parts) {
    if (!order.websiteEditedAt || parts.length) return null;
    let totals;
    try { totals = OrderFinance.calculateOrder(order.lines || [], { shippingCost:Number(order.shippingFee ?? order.shippingCost ?? 0), orderDiscount:order.orderDiscount || 0, orderDiscountType:order.orderDiscountType || "percent" }); }
    catch { return null; }
    const books = new Map((db.books || []).map(book => [book.id, book]));
    return {
      editedAt:order.websiteEditedAt, subtotal:round(totals.subtotalBeforeDiscount - totals.productDiscountTotal), orderDiscount:round(totals.orderDiscountAmount), shippingFee:round(totals.shipping), total:round(totals.total),
      lines:totals.lines.map(line => ({ bookId:line.bookId, name:String(books.get(line.bookId)?.name || line.bookId), qty:line.qty, unitPrice:round(line.unitOriginalPrice), discount:round(line.discountAmount), subtotal:round(line.lineFinalAmount) }))
    };
  }

  function orderLink(db, order) {
    const shipment = orderShipment(db, order);
    const total = round(Number(order.total || 0)), paid = round(Number(order.paidAmount || 0));
    const remaining = remainingOf(order);
    const parts = linkParts(db, order);
    return {
      websiteOrderNumber:order.websiteOrderNumber, websiteOrderId:order.websiteOrderId ?? null, integrationId:order.integrationId || null,
      salesOrderId:order.id, workflowStage:order.workflowStage || "draft", status:order.status || "",
      total, depositAmount:round(Number(order.depositAmount ?? order.deposit?.amount ?? 0)), depositRequired:depositRequiredOf(order), paidAmount:paid, remainingAmount:remaining,
      paymentStatus:order.paymentStatus || OrderFinance.calculatePayment(total, Math.min(total, paid)).paymentStatus,
      shipment:shipmentSummary(shipment), cancelled:isCancelled(order), chatwootConversationId:order.chatwootConversationId || null,
      ...(parts.length ? { splitShipment:{ extraShippingFee:round(Number(order.splitShipment?.extraShippingFee || 0)), splitAt:order.splitShipment?.splitAt || null, parts } } : {}),
      ...(order.websiteEditedAt && !parts.length ? { edited:orderEdit(db, order, parts) } : {}),
      updatedAt:latestIso(order.updatedAt, order.createdAt, shipment?.updatedAt, shipment?.lastTrackedAt, ...parts.map(part => part.updatedAt))
    };
  }

  function orderLinks(db, revision, updatedSince = "") {
    let since = null;
    if (updatedSince) {
      since = Date.parse(updatedSince);
      if (!Number.isFinite(since)) throw websiteError(400, "INVALID_QUERY", "قيمة updatedSince غير صالحة.");
    }
    const links = (db.onlineOrders || []).filter(order => order.websiteOrderNumber).map(order => orderLink(db, order))
      .filter(link => since === null || (link.updatedAt && Date.parse(link.updatedAt) >= since));
    return { ok:true, revision:String(revision), links };
  }

  function findWebsiteOrder(db, websiteOrderNumber) {
    return (db.onlineOrders || []).find(order => !order.deletedAt && order.websiteOrderNumber === websiteOrderNumber) || null;
  }

  function duplicateTransferMatches(db, { reference = "", senderPhone = "", amount = 0, excludeOrderId = "", now = Date.now() } = {}) {
    const ref = normalizeTransferReference(reference), phone = normalizeEgyptPhone(senderPhone), value = round(Number(amount || 0));
    if (!ref && !(phone && value > 0)) return [];
    const orders = new Map((db.onlineOrders || []).map(order => [order.id, order]));
    const matches = [];
    for (const payment of db.orderPayments || []) {
      if (payment.status === "reversed" || payment.confirmed === false || payment.deletedAt || (excludeOrderId && payment.orderId === excludeOrderId)) continue;
      const byReference = Boolean(ref) && normalizeTransferReference(payment.transferReferenceNormalized || payment.transferReference) === ref;
      const receivedAt = Date.parse(payment.receivedAt || "");
      const bySender = Boolean(phone) && value > 0 && normalizeEgyptPhone(payment.senderPhone) === phone && round(Number(payment.amount || 0)) === value && Number.isFinite(receivedAt) && Math.abs(now - receivedAt) <= DUPLICATE_SENDER_WINDOW_MS;
      if (!byReference && !bySender) continue;
      const order = orders.get(payment.orderId);
      matches.push({ paymentId:payment.id, orderId:payment.orderId || "", websiteOrderNumber:order?.websiteOrderNumber || "", customerName:order?.customerName || "", amount:round(Number(payment.amount || 0)), receivedAt:payment.receivedAt || "", senderPhone:payment.senderPhone || "", transferReference:payment.transferReference || "", matchedBy:byReference ? "reference" : "sender_phone_amount" });
    }
    return matches;
  }

  // Per-line view of a Store order against the System right now. Quantities are compared per book (two lines of the
  // same book share the shelf), so every line of a book carries the same status.
  function evaluateLines(db, storeOrder) {
    const items = Array.isArray(storeOrder?.items) ? storeOrder.items : [];
    const books = new Map((db.books || []).map(book => [book.id, book]));
    const requested = new Map();
    for (const item of items) {
      const book = item?.externalBookId ? books.get(String(item.externalBookId)) : null;
      if (book && !book.deletedAt) requested.set(book.id, (requested.get(book.id) || 0) + Math.max(0, Math.trunc(Number(item.quantity) || 0)));
    }
    return items.map((item, index) => {
      const book = item?.externalBookId ? books.get(String(item.externalBookId)) : null;
      const linked = Boolean(book && !book.deletedAt);
      const quantity = Number(item?.quantity), unitPrice = Number(item?.unitPrice);
      const available = linked ? availableStock(book) : 0;
      const requestedForBook = linked ? requested.get(book.id) : Math.max(0, Math.trunc(quantity) || 0);
      const shortQuantity = linked ? Math.max(0, requestedForBook - available) : requestedForBook;
      const allowPreorder = linked && book.allowPreorder === true;
      const status = !linked ? "not_linked" : shortQuantity === 0 ? "available" : allowPreorder ? "preorder" : "unavailable";
      const systemPrice = linked ? round(Number(book.price || 0)) : null;
      return {
        index, productId:item?.productId ?? null, externalBookId:item?.externalBookId || null, bookId:linked ? book.id : null,
        name:String(item?.nameAr || book?.name || item?.externalBookId || "—"), systemName:book?.name || "", deleted:Boolean(book?.deletedAt), linked,
        quantity, unitPrice:Number.isFinite(unitPrice) ? round(unitPrice) : null, subtotal:round(Number(item?.subtotal ?? quantity * unitPrice) || 0),
        systemPrice, priceChanged:linked && Number.isFinite(unitPrice) && systemPrice !== round(unitPrice),
        available, requestedForBook, shortQuantity, allowPreorder, status,
        preorderEligible:status === "preorder" && storeOrder?.preorderConsent === true,
        availabilityAtOrder:item?.availabilityAtOrder || "", preorderQuantityAtOrder:Number(item?.preorderQuantity || 0)
      };
    });
  }

  function requiredDeposit(db, storeOrder) {
    const total = round(Number(storeOrder?.total || 0));
    const snapshot = Number(storeOrder?.depositRequired);
    return storeOrder?.depositRequired != null && Number.isFinite(snapshot) && snapshot >= 0 ? round(Math.min(snapshot, total)) : round(Math.min(depositDefault(db), total));
  }

  function storeOrderTotals(storeOrder, lines) {
    return OrderFinance.calculateOrder(lines, { orderDiscount:Number(storeOrder?.couponDiscount || 0), orderDiscountType:"amount", shippingCost:Number(storeOrder?.shippingCost || 0) });
  }

  function isPending(storeOrder) {
    return storeOrder?.status === "awaiting_confirmation" && !storeOrder?.archived && !storeOrder?.salesOrderId;
  }

  function storeOrderSummary(storeOrder, config = {}) {
    return {
      id:storeOrder.id, orderNumber:storeOrder.orderNumber, integrationId:storeOrder.integrationId || null, status:storeOrder.status, contactStatus:storeOrder.contactStatus || "", paymentStatus:storeOrder.paymentStatus || "",
      archived:Boolean(storeOrder.archived), salesOrderId:storeOrder.salesOrderId || null, chatwootConversationId:storeOrder.chatwootConversationId || null,
      customer:{ name:storeOrder.customer?.name || "", mobile:storeOrder.customer?.mobile || "", altMobile:storeOrder.customer?.altMobile || "" },
      address:{ governorate:storeOrder.address?.governorate || "", city:storeOrder.address?.city || "", detailedAddress:storeOrder.address?.detailedAddress || "", landmark:storeOrder.address?.landmark || "" },
      notes:{ delivery:storeOrder.notes?.delivery || "", order:storeOrder.notes?.order || "" },
      subtotal:round(Number(storeOrder.subtotal || 0)), couponDiscount:round(Number(storeOrder.couponDiscount || 0)), couponCode:storeOrder.couponCode || "", shippingCost:round(Number(storeOrder.shippingCost || 0)), total:round(Number(storeOrder.total || 0)),
      depositRequired:storeOrder.depositRequired ?? null, preorderConsent:storeOrder.preorderConsent === true, splitShipmentPreference:storeOrder.splitShipmentPreference || "single",
      splitExtraShippingFee:storeOrder.splitExtraShippingFee ?? null, createdAt:storeOrder.createdAt || null,
      storeAdminUrl:config.storeAdminOrderUrl && storeOrder.id != null ? `${config.storeAdminOrderUrl}${encodeURIComponent(String(storeOrder.id))}` : ""
    };
  }

  // What would ship now and later if the order is split after approval (per book, as the shelf is shared).
  function splitPreview(lines, storeOrder) {
    const books = new Map();
    for (const line of lines.filter(item => item.linked)) if (!books.has(line.bookId)) books.set(line.bookId, { bookId:line.bookId, name:line.name, qty:line.requestedForBook, now:Math.min(line.requestedForBook, line.available) });
    const rows = [...books.values()].map(row => ({ ...row, later:row.qty - row.now }));
    const nowQty = rows.reduce((sum, row) => sum + row.now, 0), laterQty = rows.reduce((sum, row) => sum + row.later, 0);
    const quoted = Number(storeOrder?.splitExtraShippingFee);
    return { preference:storeOrder?.splitShipmentPreference || "single", quotedFee:storeOrder?.splitExtraShippingFee != null && Number.isFinite(quoted) ? round(quoted) : null, rows, nowQty, laterQty, splittable:nowQty > 0 && laterQty > 0 };
  }

  // GET /api/website-orders/:number — everything the approval form needs, computed against the System right now.
  function approvalPreview(db, storeOrder, { query = {}, user = null, config = {}, now = Date.now() } = {}) {
    const lines = evaluateLines(db, storeOrder);
    const required = requiredDeposit(db, storeOrder);
    let computedTotal = null;
    try { computedTotal = storeOrderTotals(storeOrder, lines.filter(line => line.unitPrice != null).map(line => ({ bookId:line.bookId, qty:line.quantity, price:line.unitPrice, discount:0, discountType:"percent", discountScope:"unit" }))).total; } catch {}
    const existing = findWebsiteOrder(db, storeOrder.orderNumber);
    const customerPhones = [storeOrder.customer?.mobile, storeOrder.customer?.altMobile].map(normalizeEgyptPhone).filter(Boolean);
    const amount = query.amount !== undefined && query.amount !== "" ? Number(asciiDigits(query.amount)) : required;
    const warnings = new Map();
    for (const phone of query.senderPhone ? [query.senderPhone] : customerPhones) for (const match of duplicateTransferMatches(db, { senderPhone:phone, amount, now })) warnings.set(match.paymentId, match);
    if (query.reference) for (const match of duplicateTransferMatches(db, { reference:query.reference, now })) warnings.set(match.paymentId, match);
    return {
      ok:true,
      order:storeOrderSummary(storeOrder, config),
      lines,
      priceDiffs:lines.filter(line => line.priceChanged).map(line => ({ bookId:line.bookId, name:line.name, websitePrice:line.unitPrice, systemPrice:line.systemPrice })),
      shortages:lines.filter(line => line.linked && line.shortQuantity > 0).map(line => ({ bookId:line.bookId, name:line.name, requested:line.requestedForBook, available:line.available, short:line.shortQuantity, allowPreorder:line.allowPreorder, preorderEligible:line.preorderEligible })),
      unlinked:lines.filter(line => !line.linked).map(line => ({ productId:line.productId, externalBookId:line.externalBookId, name:line.name })),
      preorderConsentAtCheckout:storeOrder.preorderConsent === true,
      depositRequired:required, depositDefault:depositDefault(db),
      total:round(Number(storeOrder.total || 0)), computedTotal, totalMatches:computedTotal != null && Math.abs(computedTotal - Number(storeOrder.total || 0)) <= 0.01,
      pending:isPending(storeOrder),
      existingSalesOrder:existing ? { id:existing.id, workflowStage:existing.workflowStage, status:existing.status } : null,
      duplicateTransferWarnings:[...warnings.values()],
      split:splitPreview(lines, storeOrder),
      permissions:user ? { approve:canOrderAction(db, user, "order.website.approve"), depositOverride:canOrderAction(db, user, "order.deposit.override"), receivePayment:canOrderAction(db, user, "order.payment.receive"), splitShipment:canOrderAction(db, user, "order.split.shipment") } : undefined
    };
  }

  function listSummary(db, storeOrder, config = {}) {
    const lines = evaluateLines(db, storeOrder);
    const existing = findWebsiteOrder(db, storeOrder.orderNumber);
    return {
      ...storeOrderSummary(storeOrder, config),
      itemCount:lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0),
      lines:lines.map(line => ({ name:line.name, quantity:line.quantity, unitPrice:line.unitPrice, systemPrice:line.systemPrice, status:line.status, available:line.available })),
      priceChanges:lines.filter(line => line.priceChanged).length,
      shortages:lines.filter(line => line.status === "unavailable").length,
      preorderLines:lines.filter(line => line.status === "preorder").length,
      unlinked:lines.filter(line => !line.linked).length,
      depositRequired:requiredDeposit(db, storeOrder),
      existingSalesOrderId:existing?.id || null
    };
  }

  function buildNotes(storeOrder, staffNotes) {
    const parts = [
      storeOrder.notes?.delivery && `ملاحظات التوصيل (الموقع): ${storeOrder.notes.delivery}`,
      storeOrder.notes?.order && `ملاحظات الطلب (الموقع): ${storeOrder.notes.order}`,
      String(staffNotes || "").trim()
    ].filter(Boolean);
    return OrderFinance.normalizeNote(parts.join("\n").slice(0, 5000));
  }

  // ARCHITECTURE_TO_BE §7 step 2. Pure and synchronous: mutates `db` (the caller's private snapshot) and returns
  // { order, existing }, or throws websiteError(status, code, message, details) leaving the caller to discard `db`.
  function approve(db, storeOrder, payload = {}, user, nowValue = new Date()) {
    const now = nowValue.toISOString(), nowMs = nowValue.getTime();
    const websiteOrderNumber = String(storeOrder?.orderNumber || "");
    if (!canOrderAction(db, user, "order.website.approve")) throw websiteError(403, "PERMISSION_DENIED", "ليس لديك صلاحية اعتماد طلبات الموقع.");
    const existing = findWebsiteOrder(db, websiteOrderNumber);
    if (existing) return { order:existing, existing:true };
    if (!isPending(storeOrder)) throw websiteError(409, "WEBSITE_ORDER_NOT_PENDING", "طلب الموقع ليس بانتظار الاعتماد (تم ربطه أو إلغاؤه أو أرشفته).", { status:storeOrder?.status || "", archived:Boolean(storeOrder?.archived), salesOrderId:storeOrder?.salesOrderId || null });
    const items = Array.isArray(storeOrder.items) ? storeOrder.items : [];
    if (!items.length || items.some(item => !Number.isInteger(Number(item?.quantity)) || Number(item.quantity) <= 0 || !Number.isFinite(Number(item?.unitPrice)) || Number(item.unitPrice) < 0)) throw websiteError(422, "WEBSITE_ORDER_INVALID", "بيانات أصناف طلب الموقع غير صالحة.");
    const lines = evaluateLines(db, storeOrder);
    const unlinked = lines.filter(line => !line.linked);
    if (unlinked.length) throw websiteError(409, "PRODUCT_NOT_LINKED", "بعض منتجات الطلب غير مربوطة بكتاب موجود في السيستم.", { lines:unlinked.map(line => ({ productId:line.productId, externalBookId:line.externalBookId, name:line.name, deleted:line.deleted })) });
    const diffs = lines.filter(line => line.priceChanged).map(line => ({ bookId:line.bookId, name:line.name, websitePrice:line.unitPrice, systemPrice:line.systemPrice }));
    // Owner decision 2026-10-20: the Store dashboard owns the website price and
    // discount, so the customer's website price is the agreed price. A difference
    // from book.price is recorded on the order for information and never blocks.
    // Availability now. A short book may only become a pre-order when the book allows it, the customer agreed at
    // checkout AND the employee confirmed that consent for this book. Otherwise nothing is written.
    const consent = payload.preorderConsent && typeof payload.preorderConsent === "object" ? payload.preorderConsent : {};
    const shortBooks = new Map(lines.filter(line => line.shortQuantity > 0).map(line => [line.bookId, line]));
    const shortLine = line => ({ bookId:line.bookId, name:line.name, requested:line.requestedForBook, available:line.available, short:line.shortQuantity, allowPreorder:line.allowPreorder });
    const outOfStock = [...shortBooks.values()].filter(line => !line.allowPreorder && consent[line.bookId] !== true);
    if (outOfStock.length) throw websiteError(409, "OUT_OF_STOCK", "الكمية المتاحة لا تكفي، وهذه الكتب لا تسمح بالحجز المسبق.", { lines:outOfStock.map(shortLine) });
    const notAllowed = [...shortBooks.values()].filter(line => !line.allowPreorder);
    if (notAllowed.length) throw websiteError(409, "PREORDER_NOT_ALLOWED", "الحجز المسبق غير مسموح لهذه الكتب في السيستم.", { lines:notAllowed.map(shortLine) });
    const missingConsent = [...shortBooks.values()].filter(line => storeOrder.preorderConsent !== true || consent[line.bookId] !== true);
    if (missingConsent.length) throw websiteError(409, "PREORDER_CONSENT_REQUIRED", "يلزم موافقة العميل المسجلة على الحجز المسبق لهذه الكتب.", { lines:missingConsent.map(line => ({ ...shortLine(line), customerConsentRecorded:storeOrder.preorderConsent === true, employeeConfirmed:consent[line.bookId] === true })) });
    // Lines are priced exactly as the customer was quoted on the website; a coupon becomes an order discount.
    const orderLines = lines.map(line => ({ bookId:line.bookId, qty:line.quantity, price:line.unitPrice, discount:0, discountType:"percent", discountScope:"unit", websiteUnitPrice:line.unitPrice, systemPriceAtApproval:line.systemPrice, websiteProductId:line.productId }));
    let totals;
    try { totals = storeOrderTotals(storeOrder, orderLines); } catch (error) { throw websiteError(422, "WEBSITE_ORDER_INVALID", error.message); }
    if (Math.abs(totals.total - Number(storeOrder.total || 0)) > 0.01) throw websiteError(409, "WEBSITE_ORDER_TOTAL_MISMATCH", "إجمالي طلب الموقع لا يطابق أسعاره وشحنه؛ راجع الطلب في لوحة المتجر.", { websiteTotal:round(Number(storeOrder.total || 0)), computedTotal:totals.total });
    const phone = normalizeEgyptPhone(storeOrder.customer?.mobile);
    if (!phone) throw websiteError(422, "WEBSITE_ORDER_INVALID", "رقم موبايل العميل في طلب الموقع غير صالح.");
    // Deposit (العربون).
    const deposit = payload.deposit && typeof payload.deposit === "object" ? payload.deposit : {};
    const required = requiredDeposit(db, storeOrder);
    const amount = deposit.amount === undefined || deposit.amount === null || deposit.amount === "" ? 0 : OrderFinance.normalizeNumber(deposit.amount);
    if (!Number.isFinite(amount) || amount < 0) throw websiteError(400, "DEPOSIT_INVALID", "مبلغ العربون غير صالح.");
    const overrideReason = String(deposit.overrideReason || "").trim().slice(0, 500);
    const override = round(amount) < required;
    if (override && !(canOrderAction(db, user, "order.deposit.override") && overrideReason)) throw websiteError(409, "DEPOSIT_TOO_LOW", `العربون المطلوب لهذا الطلب ${required} ج.م.`, { required, amount:round(amount), overrideAllowed:canOrderAction(db, user, "order.deposit.override") });
    if (round(amount) > totals.total) throw websiteError(409, "DEPOSIT_EXCEEDS_TOTAL", "العربون لا يمكن أن يتجاوز إجمالي الطلب.", { total:totals.total, amount:round(amount) });
    const senderPhoneInput = String(deposit.senderPhone || "").trim(), senderPhone = senderPhoneInput ? normalizeEgyptPhone(senderPhoneInput) : "";
    const senderName = String(deposit.senderName || "").trim().slice(0, 120), reference = String(deposit.reference || "").trim().slice(0, 120);
    const receiptMethod = String(deposit.receiptMethod || "").trim().slice(0, 60) || "تحويل";
    if (amount > 0) {
      if (deposit.receivedConfirmed !== true) throw websiteError(409, "DEPOSIT_NOT_CONFIRMED", "أكد أن المبلغ وصل فعليًا قبل الاعتماد.");
      if (!canOrderAction(db, user, "order.payment.receive")) throw websiteError(403, "PAYMENT_PERMISSION_DENIED", "ليس لديك صلاحية تسجيل استلام دفعة.");
      if (!(db.cashAccounts || []).some(item => item.id === String(deposit.cashAccountId || "").trim() && item.active !== false)) throw websiteError(400, "CASH_ACCOUNT_REQUIRED", "اختر الخزنة أو الحساب الذي استلم العربون.");
      if (senderPhoneInput && !senderPhone) throw websiteError(400, "INVALID_SENDER_PHONE", "رقم المحوّل غير صحيح.");
      if (!/كاش|نقد|cash/i.test(receiptMethod) && !reference && !senderPhone) throw websiteError(400, "TRANSFER_DETAILS_REQUIRED", "اكتب رقم المحوّل أو مرجع التحويل.");
      const matches = duplicateTransferMatches(db, { reference, senderPhone, amount, now:nowMs });
      if (matches.length && payload.duplicateTransferReviewed !== true) throw websiteError(409, "DUPLICATE_TRANSFER_SUSPECTED", "يوجد تحويل مسجل بنفس المرجع أو بنفس رقم المحوّل والمبلغ على طلب آخر. راجعه قبل الاعتماد.", { matches });
    }
    const shippingCompany = orderShippingCompany(db, payload.shippingCompany);
    // Customer: found by normalized phone, else created (an existing customer is not overwritten, as in quick orders).
    db.customers = db.customers || []; db.onlineOrders = db.onlineOrders || [];
    const governorate = String(storeOrder.address?.governorate || "").trim(), city = String(storeOrder.address?.city || "").trim();
    const address = String(storeOrder.address?.detailedAddress || "").trim(), addressMark = String(storeOrder.address?.landmark || "").trim();
    const alternativePhone = normalizeEgyptPhone(storeOrder.customer?.altMobile);
    const customerName = String(storeOrder.customer?.name || "").trim() || phone;
    let customer = db.customers.find(item => !item.deletedAt && normalizeEgyptPhone(item.phone) === phone);
    if (!customer) {
      customer = { id:nextId("C", db.customers), name:customerName, phone, alternativePhone, governorate, city, address, addressMark, type:"أونلاين", source:"website", createdAt:now, updatedAt:now, deletedAt:null };
      db.customers.push(customer);
    }
    const preorderConsent = Object.fromEntries([...shortBooks.keys()].map(bookId => [bookId, true]));
    const paymentPlan = amount <= 0 ? "cash_on_delivery" : round(amount) >= totals.total ? "prepaid_full" : "advance_cod";
    const paymentMethod = ({ cash_on_delivery:"الدفع عند الاستلام", advance_cod:"مقدم + الباقي عند الاستلام", prepaid_full:"مدفوع بالكامل مسبقًا" })[paymentPlan];
    const order = {
      id:nextId("ORD-", db.onlineOrders), date:now.slice(0, 10), customerId:customer.id, customerName, phone, alternativePhone:alternativePhone || customer.alternativePhone || "",
      governorate, city, address, addressMark, source:"website", sourcePlatform:"store",
      websiteOrderNumber, websiteOrderId:storeOrder.id ?? null, integrationId:storeOrder.integrationId || crypto.randomUUID(), chatwootConversationId:storeOrder.chatwootConversationId ? String(storeOrder.chatwootConversationId) : "",
      paymentMethod, shippingCompany, shippingCost:totals.shipping, shippingFee:totals.shipping, shippingFeeOverride:true, shippingPriceSource:`website:${websiteOrderNumber}`,
      orderDiscount:round(Number(storeOrder.couponDiscount || 0)), orderDiscountType:"amount", couponCode:String(storeOrder.couponCode || ""),
      status:"مسودة", workflowStage:"draft", lines:totals.lines, subtotal:totals.subtotal, discountTotal:totals.discountTotal, total:totals.total, notes:buildNotes(storeOrder, payload.notes),
      depositRequired:required, depositAmount:round(amount),
      deposit:{ required, amount:round(amount), defaultAtApproval:depositDefault(db), override, overrideReason:override ? overrideReason : "", receiptMethod:amount > 0 ? receiptMethod : "" },
      websitePreorderConsent:storeOrder.preorderConsent === true, preorderConsent, websiteSplitShipmentPreference:storeOrder.splitShipmentPreference || "single",
      ...(storeOrder.splitExtraShippingFee != null && Number.isFinite(Number(storeOrder.splitExtraShippingFee)) ? { websiteSplitExtraShippingFee:round(Number(storeOrder.splitExtraShippingFee)) } : {}),
      priceChangesAcknowledged:diffs, websiteApprovedAt:now, websiteApprovedBy:user.name || user.username, websiteApprovedByUsername:user.username,
      createdAt:now, createdBy:user.name || user.username, createdByUsername:user.username, updatedAt:now, deletedAt:null
    };
    // Same payment path as quick orders (one advance payment, cash row, order.payment.receive check), then the
    // transfer details are added to that payment row.
    applyQuickOrderPayment(db, order, { paidAmount:round(amount), paymentConfirmed:amount > 0, receiptMethod, cashAccountId:deposit.cashAccountId, paymentPlan, paymentMethod }, user);
    const receipt = order.paymentReceiptId ? (db.orderPayments || []).find(item => item.id === order.paymentReceiptId) : null;
    if (receipt) Object.assign(receipt, { source:"website_deposit", websiteOrderNumber, senderPhone, senderName, transferReference:reference, transferReferenceNormalized:normalizeTransferReference(reference), depositRequired:required, depositOverride:override, duplicateTransferReviewed:payload.duplicateTransferReviewed === true });
    db.onlineOrders.push(order);
    appendOrderAudit(db, user, order, "اعتماد طلب الموقع وإنشاء طلب مبيعات", `${websiteOrderNumber}${diffs.length ? ` · فرق سعر معتمد: ${diffs.map(diff => `${diff.bookId} ${diff.websitePrice}←${diff.systemPrice}`).join("، ")}` : ""}${override ? ` · عربون أقل من المطلوب (${round(amount)} من ${required}): ${overrideReason}` : ""}`);
    // Confirm with the System's own logic. Option A: any short book makes the whole order a pre-order holding no copies.
    reserveOrderInventory(db, order, user, order.lines, { allowBackorder:true });
    Object.assign(order, { confirmedAt:now, confirmedBy:user.name || user.username, confirmedByUsername:user.username });
    const stage = applyBackorderStage(order, user, now);
    appendOrderAudit(db, user, order, "تأكيد الطلب وحجز المخزون", stage === "awaiting_stock" ? `حجز مسبق: ${(order.backorderLines || []).map(line => `${line.bookId}×${line.qty}`).join("، ")}` : "انتقل إلى قائمة التجهيز");
    // Option B on approval: the employee confirms the customer's agreement to two shipments and the extra fee.
    // A split that cannot happen fails the whole approval (nothing is written).
    const splitRequest = payload.splitShipment && typeof payload.splitShipment === "object" ? payload.splitShipment : null;
    if (splitRequest?.execute === true) {
      if (!splitShipment) throw websiteError(501, "SPLIT_NOT_AVAILABLE", "تقسيم الشحن غير متاح.");
      if (!canOrderAction(db, user, "order.split.shipment")) throw websiteError(403, "SPLIT_PERMISSION_DENIED", "ليس لديك صلاحية تقسيم شحن الطلبات.");
      if (stage !== "awaiting_stock") throw websiteError(409, "ORDER_FULLY_AVAILABLE", "كل كتب الطلب متاحة الآن؛ لا حاجة للتقسيم.");
      const { child } = splitShipment.split(db, order, { extraShippingFee:splitRequest.extraShippingFee, customerConsent:splitRequest.customerConsent === true, consentChannel:splitRequest.consentChannel || (storeOrder.splitShipmentPreference === "split" ? "الموقع" : "واتساب"), consentNote:splitRequest.consentNote }, user, nowValue);
      return { order, child, existing:false };
    }
    return { order, existing:false };
  }

  function salesLinkBody(order, user) {
    return {
      salesOrderId:order.id, integrationId:order.integrationId || null, workflowStage:order.workflowStage || "awaiting_preparation",
      depositAmount:round(Number(order.depositAmount || 0)), depositRequired:depositRequiredOf(order), paidAmount:round(Number(order.paidAmount || 0)), remainingAmount:round(Number(order.remainingAmount ?? order.total ?? 0)),
      paymentStatus:order.paymentStatus || "unpaid", approvedBy:user?.username || order.websiteApprovedByUsername || null, approvedAt:order.websiteApprovedAt || order.createdAt || null
    };
  }

  // Chatwood panel (read-only): one customer card plus every order of that customer, grouped into current orders
  // and history. A customer is the phone (primary or alternate, after normalization) and, for the open
  // conversation, any order linked to that conversation id. Orders without a conversation id are found by phone.
  // Store orders already linked to a System order are folded into it, so no order appears twice.
  const PANEL_LIMIT = 200;
  const PANEL_PHASES = {
    awaiting_confirmation:{ group:"current", label:"بانتظار التأكيد" }, awaiting_deposit:{ group:"current", label:"بانتظار العربون" },
    preparing:{ group:"current", label:"قيد التجهيز" }, shipped:{ group:"current", label:"تم الشحن" }, preorder:{ group:"current", label:"حجز مسبق جارٍ" },
    delivered:{ group:"history", label:"تم التسليم" }, cancelled:{ group:"history", label:"ملغي" }, returned:{ group:"history", label:"مرتجع" },
    not_completed:{ group:"history", label:"لم يكتمل (مؤرشف)" }, previous:{ group:"history", label:"طلب سابق" }
  };
  const SOURCE_LABELS = { website:"الموقع", whatsapp:"واتساب", system:"السيستم", cashier:"مبيعات السيستم" };

  function systemOrderPhase(order, shipment) {
    if (isCancelled(order)) return "cancelled";
    const stage = String(order.workflowStage || ""), ship = String(shipment?.normalizedStatus || shipment?.shippingStatus || "");
    if (stage === "returned" || /return/.test(ship) || /مرتجع/.test(String(order.status || ""))) return "returned";
    if (stage === "delivered" || ship === "delivered" || order.status === "تم التسليم") return "delivered";
    if (stage === "shipped" || order.shipmentId) return "shipped";
    if (stage === "awaiting_stock") return "preorder";
    if (!order.confirmedAt && ["draft", "new", ""].includes(stage)) return "awaiting_confirmation";
    const required = Number(order.depositRequired || 0), paid = Number(order.paidAmount || 0);
    if (required > 0 && paid < required) return "awaiting_deposit";
    return "preparing";
  }

  function storeOrderPhase(storeOrder) {
    if (isPending(storeOrder)) return "awaiting_confirmation";
    if (storeOrder.archived) return "not_completed";
    if (["cancelled"].includes(storeOrder.status)) return "cancelled";
    if (["returned", "partially_returned"].includes(storeOrder.status)) return "returned";
    if (storeOrder.status === "delivered") return "delivered";
    return "previous";
  }

  // Who owns an order, when the System knows it: the Chatwood conversation and contact it was made from and that
  // contact's WhatsApp number; for website orders the buyer's own mobile. The delivery phone of a quick order is the
  // recipient's and proves nothing about the owner once an owner is recorded.
  function orderOwner(order) {
    const phones = order.source === "website" || order.websiteOrderNumber ? [order.phone, order.alternativePhone] : [order.customerWhatsAppPhone];
    const owner = { conversationId:/^\d{1,18}$/.test(String(order.chatwootConversationId || "").trim()) ? String(order.chatwootConversationId).trim() : "", contactId:/^\d{1,18}$/.test(String(order.chatwootContactId || "")) ? String(order.chatwootContactId) : "", phones:phones.map(normalizeEgyptPhone).filter(Boolean) };
    return { ...owner, known:Boolean(owner.conversationId || owner.contactId || owner.phones.length) };
  }

  function panelCustomer(db, phone, storeOrders = [], { conversationId = "", contactId = "", config = {} } = {}) {
    const conversation = /^\d{1,18}$/.test(String(conversationId || "")) ? String(conversationId) : "";
    const contact = /^\d{1,18}$/.test(String(contactId || "")) ? String(contactId) : "";
    const byPhone = value => Boolean(phone) && normalizeEgyptPhone(value) === phone;
    const customers = (db.customers || []).filter(item => !item.deletedAt && [item.phone, item.alternativePhone].some(byPhone));
    const customerIds = new Set(customers.map(item => item.id));
    const books = new Map((db.books || []).map(book => [book.id, book]));
    const products = lines => (lines || []).map(line => ({ name:books.get(line.bookId || line.productId)?.name || line.name || line.nameAr || line.bookId || "—", qty:Number(line.qty ?? line.quantity ?? 0) }));
    const sales = (db.sales || []).filter(sale => !sale.deletedAt && customerIds.has(sale.customerId));
    // Owner evidence first (conversation, contact, the contact's WhatsApp number); the phone is an extra lookup.
    // A phone match counts as this customer's order unless the recorded owner contradicts it (another contact, or
    // another WhatsApp number): then this number is only the recipient. Another conversation alone is no
    // contradiction, since one customer can have several conversations.
    const matchedBy = new Map();
    const ownerMatch = owner => (conversation && owner.conversationId === conversation) ? "conversation" : (contact && owner.contactId === contact) ? "contact" : (phone && owner.phones.includes(phone)) ? "whatsapp" : "";
    const otherOwner = owner => Boolean((contact && owner.contactId && owner.contactId !== contact) || (phone && owner.phones.length && !owner.phones.includes(phone)));
    for (const order of db.onlineOrders || []) {
      if (order.deletedAt) continue;
      const owner = orderOwner(order), byOwner = ownerMatch(owner);
      const phoneHit = customerIds.has(order.customerId) || [order.phone, order.alternativePhone].some(byPhone);
      if (byOwner) matchedBy.set(order.id, byOwner);
      else if (phoneHit) matchedBy.set(order.id, otherOwner(owner) ? "recipient" : "phone");
    }
    // An invoice of this customer brings its order too (saved under another phone), unless that order has another owner.
    for (const sale of sales) {
      const order = sale.onlineOrderId && !matchedBy.has(sale.onlineOrderId) ? (db.onlineOrders || []).find(item => item.id === sale.onlineOrderId && !item.deletedAt) : null;
      if (order) matchedBy.set(order.id, otherOwner(orderOwner(order)) ? "recipient" : "invoice");
    }
    const recipientIds = new Set([...matchedBy].filter(([, how]) => how === "recipient").map(([id]) => id));
    const realSales = sales.filter(sale => !recipientIds.has(sale.onlineOrderId) && !/ملغ|باطل|cancel|void/i.test(String(sale.status || "")) && !sale.cancelledAt && !sale.voidedAt);
    const orders = (db.onlineOrders || []).filter(order => matchedBy.has(order.id) && !recipientIds.has(order.id));
    // Orders where this number is only the delivery phone: enough to answer «where is my parcel», nothing more.
    const recipientOrders = (db.onlineOrders || []).filter(order => recipientIds.has(order.id)).map(order => {
      const shipmentRecord = orderShipment(db, order), shipment = shipmentSummary(shipmentRecord), phase = systemOrderPhase(order, shipmentRecord);
      return { salesOrderId:order.id, websiteOrderNumber:order.websiteOrderNumber || "", createdAt:order.createdAt || order.date || "", phase, phaseLabel:PANEL_PHASES[phase].label, shipment, trackingNumber:shipment?.trackingNumber || "", links:{ system:`/?view=onlineOrders&focus=order:${encodeURIComponent(order.id)}` } };
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const storeByNumber = new Map(storeOrders.map(order => [order.orderNumber, order]));
    const storeBySalesId = new Map(storeOrders.filter(order => order.salesOrderId).map(order => [order.salesOrderId, order]));
    const storeUrl = storeOrder => storeOrder?.id != null && config.storeAdminOrderUrl ? `${config.storeAdminOrderUrl}${encodeURIComponent(String(storeOrder.id))}` : "";
    const describe = phase => ({ phase, phaseLabel:PANEL_PHASES[phase].label, group:PANEL_PHASES[phase].group });
    const merged = new Set();
    const entries = orders.map(order => {
      const storeOrder = storeBySalesId.get(order.id) || (order.websiteOrderNumber ? storeByNumber.get(order.websiteOrderNumber) : null) || (order.parentWebsiteOrderNumber ? storeByNumber.get(order.parentWebsiteOrderNumber) : null) || null;
      if (storeOrder && !order.parentWebsiteOrderNumber) merged.add(storeOrder.orderNumber);
      const sale = order.saleId ? (db.sales || []).find(item => item.id === order.saleId) : null;
      const shipmentRecord = orderShipment(db, order), shipment = shipmentSummary(shipmentRecord);
      const total = round(Number(order.total || 0)), paid = round(Number(order.paidAmount || 0));
      const required = order.depositRequired ?? order.deposit?.required;
      const source = order.source === "website" || order.websiteOrderNumber || order.parentWebsiteOrderNumber ? "website" : order.source === "whatsapp" ? "whatsapp" : "system";
      return {
        kind:"system_order", source, sourceLabel:SOURCE_LABELS[source], websiteOrderNumber:order.websiteOrderNumber || order.parentWebsiteOrderNumber || storeOrder?.orderNumber || "", storeOrderId:storeOrder?.id ?? order.websiteOrderId ?? null,
        salesOrderId:order.id, invoiceId:order.saleId || "", splitPart:order.splitPart || null, splitFromOrderId:order.splitFromOrderId || "", parentWebsiteOrderNumber:order.parentWebsiteOrderNumber || "", splitChildOrderIds:order.splitShipment?.childOrderIds || [],
        products:products(order.lines), total, depositRequired:required == null || required === "" ? null : round(Number(required)), paid, remaining:round(Math.max(0, Number(order.remainingAmount ?? total - paid))),
        status:order.status || "", workflowStage:order.workflowStage || "", ...describe(systemOrderPhase(order, shipmentRecord)),
        shipment, trackingNumber:shipment?.trackingNumber || order.trackingNumber || order.tracking || "", chatwootConversationId:order.chatwootConversationId || storeOrder?.chatwootConversationId || "",
        linkedToConversation:Boolean(conversation) && [order.chatwootConversationId, storeOrder?.chatwootConversationId].map(value => String(value || "")).includes(conversation),
        matchedBy:matchedBy.get(order.id), createdAt:order.createdAt || order.date || "", invoiceStatus:sale?.status || "",
        links:{ system:`/?view=onlineOrders&focus=order:${encodeURIComponent(order.id)}`, store:storeUrl(storeOrder) || (order.websiteOrderId != null ? storeUrl({ id:order.websiteOrderId }) : "") }
      };
    });
    const linkedSaleIds = new Set(orders.map(order => order.saleId).filter(Boolean));
    for (const sale of sales.filter(item => !linkedSaleIds.has(item.id) && !item.onlineOrderId)) {
      const total = round(Number(sale.total || 0));
      entries.push({
        kind:"sale", source:"cashier", sourceLabel:SOURCE_LABELS.cashier, websiteOrderNumber:"", storeOrderId:null, salesOrderId:"", invoiceId:sale.id, products:products(sale.lines),
        total, depositRequired:null, paid:round(Number(sale.paid ?? sale.paidAmount ?? 0)), remaining:round(Number(sale.remaining ?? sale.remainingAmount ?? 0)),
        status:sale.status || "", workflowStage:"", ...describe(/ملغ|باطل|cancel|void/i.test(String(sale.status || "")) ? "cancelled" : "previous"),
        shipment:null, trackingNumber:"", chatwootConversationId:"", linkedToConversation:false, matchedBy:"phone", createdAt:sale.createdAt || sale.date || "",
        links:{ system:`/?view=sales&focus=invoice:${encodeURIComponent(sale.id)}`, store:"" }
      });
    }
    for (const storeOrder of storeOrders.filter(order => !merged.has(order.orderNumber))) {
      // A Store order confirmed into a System order that this customer card did not match stays a Store-only line.
      const total = round(Number(storeOrder.total || 0)), paid = round(Number(storeOrder.paidAmount || 0));
      const storePhone = [storeOrder.customer?.mobile, storeOrder.customer?.altMobile].some(byPhone);
      entries.push({
        kind:"website_order", source:"website", sourceLabel:SOURCE_LABELS.website, websiteOrderNumber:storeOrder.orderNumber, storeOrderId:storeOrder.id ?? null, salesOrderId:storeOrder.salesOrderId || "", invoiceId:"",
        products:(storeOrder.items || []).map(item => ({ name:item.nameAr || item.externalBookId || "—", qty:Number(item.quantity || 0) })),
        total, depositRequired:storeOrder.depositRequired == null ? null : round(Number(storeOrder.depositRequired)), paid, remaining:round(Math.max(0, total - paid)),
        status:storeOrder.status || "", workflowStage:"", ...describe(storeOrderPhase(storeOrder)),
        shipment:null, trackingNumber:"", chatwootConversationId:storeOrder.chatwootConversationId || "", linkedToConversation:Boolean(conversation) && String(storeOrder.chatwootConversationId || "") === conversation,
        matchedBy:storePhone ? "phone" : "conversation", awaitingApproval:isPending(storeOrder), createdAt:storeOrder.createdAt || "", links:{ system:"", store:storeUrl(storeOrder) }
      });
    }
    entries.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const primary = customers[0] || null;
    const name = primary?.name || orders[0]?.customerName || storeOrders[0]?.customer?.name || "";
    const purchasesTotal = round(realSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0));
    const paidTotal = round(realSales.reduce((sum, sale) => sum + Number(sale.paid ?? sale.paidAmount ?? 0), 0));
    const outstanding = round(realSales.reduce((sum, sale) => sum + Math.max(0, Number(sale.remaining ?? sale.remainingAmount ?? 0)), 0));
    const counts = Object.fromEntries(Object.keys(PANEL_PHASES).map(phase => [phase, entries.filter(entry => entry.phase === phase).length]));
    return {
      customer:{ name, phone:phone || "", known:Boolean(primary), identified:Boolean(primary) || entries.length > 0, customerIds:[...customerIds], status:realSales.length || entries.length > 1 ? "returning" : "new",
        ordersCount:entries.length, purchasesCount:realSales.length, purchasesTotal, paidTotal, outstanding, openOrders:entries.filter(entry => entry.group === "current").length,
        // The saved address, so the panel's order form starts filled for a returning customer.
        address:{ governorate:primary?.governorate || orders[0]?.governorate || "", city:primary?.city || orders[0]?.city || "", address:primary?.address || orders[0]?.address || "", addressMark:primary?.addressMark || orders[0]?.addressMark || "", alternativePhone:primary?.alternativePhone || "" } },
      counts, totalOrders:entries.length, truncated:entries.length > PANEL_LIMIT,
      orders:entries.slice(0, PANEL_LIMIT), recipientOrders:recipientOrders.slice(0, PANEL_LIMIT)
    };
  }

  return { normalizeEgyptPhone, catalogSnapshot, orderLinks, orderLink, findWebsiteOrder, duplicateTransferMatches, evaluateLines, requiredDeposit, depositRequiredOf, approvalPreview, listSummary, approve, salesLinkBody, panelCustomer, isPending };
}

// PUT /api/db carries the whole database from the browser. The website deposit default (owner/manager endpoint) and
// the website link fields of existing orders are server-owned, so a client save keeps the server's values.
const SERVER_OWNED_ORDER_FIELDS = ["websiteOrderNumber", "websiteOrderId", "integrationId", "source", "sourcePlatform", "depositRequired", "depositAmount", "deposit", "depositHistory", "websiteApprovedAt", "websiteApprovedBy", "websiteApprovedByUsername", "websiteEdits", "websiteEditedAt"];
// The Chatwood identity of an order (who it belongs to) and the quick-order request key are written by the server
// only; a whole-database save keeps the stored values.
const CHATWOOD_IDENTITY_FIELDS = ["chatwootConversationId", "chatwootContactId", "customerWhatsAppPhone", "quickOrderRequestId", "chatwoodLink", "chatwoodLinkHistory"];
function preserveChatwoodIdentity(current = {}, next = {}) {
  const currentOrders = new Map((current.onlineOrders || []).filter(order => order && order.id).map(order => [order.id, order]));
  for (const order of next.onlineOrders || []) {
    if (!order || typeof order !== "object") continue;
    const previous = currentOrders.get(order.id);
    // A browser-made order never brings an owner of its own: only verified server paths record one.
    if (!previous) { for (const key of ["chatwootConversationId", "chatwootContactId", "customerWhatsAppPhone", "chatwoodLink", "chatwoodLinkHistory"]) delete order[key]; continue; }
    for (const key of CHATWOOD_IDENTITY_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(previous, key)) order[key] = JSON.parse(JSON.stringify(previous[key]));
      else delete order[key];
    }
  }
  return next;
}

// Links older orders to the Chatwood contact/conversation found by the history review. Only orders with no recorded
// owner are touched; phones and customers never change; each link keeps its evidence. dryRun reports and writes nothing.
function linkOrdersToChatwood(db, links = [], { by = "integration", now = new Date().toISOString(), dryRun = true } = {}) {
  const result = { linked:[], skipped:[] };
  for (const link of Array.isArray(links) ? links : []) {
    const id = String(link?.orderId || ""), conversationId = String(link?.conversationId || ""), contactId = String(link?.contactId || "");
    const order = (db.onlineOrders || []).find(item => item.id === id && !item.deletedAt);
    if (!order) { result.skipped.push({ orderId:id, reason:"ORDER_NOT_FOUND" }); continue; }
    if (!/^\d{1,18}$/.test(conversationId) || !/^\d{1,18}$/.test(contactId)) { result.skipped.push({ orderId:id, reason:"INVALID_IDS" }); continue; }
    if (order.chatwootContactId || /^\d{1,18}$/.test(String(order.chatwootConversationId || "").trim()) || order.customerWhatsAppPhone) { result.skipped.push({ orderId:id, reason:"OWNER_ALREADY_RECORDED" }); continue; }
    if (!dryRun) Object.assign(order, { chatwootConversationId:conversationId, chatwootContactId:contactId, chatwoodLink:{ source:"history-review", evidence:Array.isArray(link.evidence) ? link.evidence.slice(0, 5).map(String) : [], linkedAt:now, linkedBy:by }, updatedAt:now });
    result.linked.push({ orderId:id, conversationId, contactId });
  }
  return result;
}

// ---- Verified links. An order has an owner once a conversation, contact or owner WhatsApp number is recorded; only
// the audited correction below changes or removes it, and none of this touches phones, customers, stock or money.
const ID = value => /^\d{1,18}$/.test(String(value ?? "").trim()) ? String(value).trim() : "";
function chatwoodOwnerOf(order = {}) {
  const owner = { conversationId:ID(order.chatwootConversationId), contactId:ID(order.chatwootContactId), customerWhatsAppPhone:/^01\d{9}$/.test(String(order.customerWhatsAppPhone || "")) ? String(order.customerWhatsAppPhone) : "", source:order.chatwoodLink?.source || "" };
  return owner.conversationId || owner.contactId || owner.customerWhatsAppPhone ? owner : null;
}

// The same customer: the same contact, the same conversation, or (with neither recorded) the same WhatsApp number.
function sameChatwoodOwner(owner, identity) {
  if (!owner) return false;
  if (owner.contactId) return owner.contactId === identity.chatwootContactId;
  if (owner.conversationId) return owner.conversationId === identity.chatwootConversationId;
  return Boolean(owner.customerWhatsAppPhone) && owner.customerWhatsAppPhone === identity.customerWhatsAppPhone;
}

function applyChatwoodLink(order, identity, { source, evidence = [], by, now }) {
  Object.assign(order, {
    chatwootConversationId:identity.chatwootConversationId, chatwootContactId:identity.chatwootContactId, customerWhatsAppPhone:identity.customerWhatsAppPhone || "",
    chatwoodLink:{ source, evidence:evidence.slice(0, 5).map(String), inboxId:identity.inboxId ?? null, linkedAt:now, linkedBy:by }, updatedAt:now,
  });
}

// Owner/manager correction: unlink, or move the order to another verified conversation. The history keeps who, when,
// why and what the link was before and after.
function correctChatwoodLink(order, { action, identity = null, reason, by, now }) {
  const before = chatwoodOwnerOf(order);
  const after = action === "relink" ? { conversationId:identity.chatwootConversationId, contactId:identity.chatwootContactId, customerWhatsAppPhone:identity.customerWhatsAppPhone || "", source:"corrected" } : null;
  const entry = { at:now, by, action, reason, before, after };
  order.chatwoodLinkHistory = [...(Array.isArray(order.chatwoodLinkHistory) ? order.chatwoodLinkHistory : []), entry].slice(-20);
  if (action === "relink") applyChatwoodLink(order, identity, { source:"corrected", evidence:["owner_correction"], by, now });
  else { for (const key of ["chatwootConversationId", "chatwootContactId", "customerWhatsAppPhone", "chatwoodLink"]) delete order[key]; order.updatedAt = now; }
  return entry;
}

// Orders named in staff messages of a verified conversation. One without an owner is a suggestion an employee
// confirms; one that belongs to another customer is a conflict to show, never to change. The order number alone
// never proves who the customer is.
function chatwoodSuggestions(db, verified) {
  const { identity, mentions = [] } = verified;
  const suggestions = [], conflicts = [];
  for (const mention of mentions) {
    const order = (db.onlineOrders || []).find(item => item.id === mention.orderRef && !item.deletedAt);
    if (!order) continue;
    const owner = chatwoodOwnerOf(order);
    const row = { orderId:order.id, createdAt:order.createdAt || order.date || "", status:order.status || "", total:Math.round(Number(order.total || 0) * 100) / 100, recipientMasked:maskPhone(order.phone), recipientIsContactPhone:Boolean(identity.customerWhatsAppPhone) && [order.phone, order.alternativePhone].includes(identity.customerWhatsAppPhone), mentionedAt:mention.mentionedAt || null, messages:Number(mention.messages || 1) };
    if (!owner) suggestions.push(row);
    else if (!sameChatwoodOwner(owner, identity)) conflicts.push({ ...row, linkedConversationId:owner.conversationId });
  }
  return { suggestions, conflicts };
}

function preserveServerOwnedFields(current = {}, next = {}) {
  if (next.settings && typeof next.settings === "object") {
    if (current.settings && Object.prototype.hasOwnProperty.call(current.settings, "websiteOrders")) next.settings.websiteOrders = JSON.parse(JSON.stringify(current.settings.websiteOrders));
    else delete next.settings.websiteOrders;
  }
  const allCurrentIds = new Set((current.onlineOrders || []).map(order => order?.id));
  const currentOrders = new Map((current.onlineOrders || []).filter(order => order?.websiteOrderNumber).map(order => [order.id, order]));
  for (const order of next.onlineOrders || []) {
    if (!order || typeof order !== "object") continue;
    // Only the approval endpoint creates website orders: a browser-made order cannot claim a website order number.
    if (!allCurrentIds.has(order.id)) { for (const key of ["websiteOrderNumber", "websiteOrderId", "integrationId"]) delete order[key]; continue; }
    const previous = currentOrders.get(order.id);
    if (!previous) { for (const key of ["websiteOrderNumber", "websiteOrderId", "integrationId"]) delete order[key]; continue; }
    for (const key of SERVER_OWNED_ORDER_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(previous, key)) order[key] = JSON.parse(JSON.stringify(previous[key]));
      else delete order[key];
    }
  }
  return next;
}

module.exports = { WEBSITE_ORDER_NUMBER_PATTERN, DEPOSIT_DEFAULT, DEPOSIT_MAX, websiteError, normalizeTransferReference, depositDefault, parseDepositDefault, createWebsiteOrders, preserveServerOwnedFields, preserveChatwoodIdentity, linkOrdersToChatwood, chatwoodOwnerOf, sameChatwoodOwner, applyChatwoodLink, correctChatwoodLink, chatwoodSuggestions };
