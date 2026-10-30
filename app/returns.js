(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Returns = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Customer and supplier returns, done on the server in one step: the page sends what was selected and the server
  // checks it, computes the money and moves stock, batches, balances, cash and statuses together (an error changes
  // nothing because the handler only saves on success). Each return keeps `effects`, exactly what it changed, so
  // reverseReturn() can undo it later. Refused deliveries have their own flow (order-refusal.js).

  const round = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  const list = (db, key) => Array.isArray(db?.[key]) ? db[key] : (db[key] = []);
  const active = rows => rows.filter(item => item && !item.deletedAt);
  const fail = (message, code, status = 409) => Object.assign(new Error(message), { code, status });
  const SALE_TYPES = ["sale", "sales_return"], PURCHASE_TYPES = ["purchase", "purchase_return"];
  // Server-only helpers for the replacement invoice (this file runs on the server).
  const Finance = typeof require === "function" ? require("./order-finance.js") : null;
  const Inventory = typeof require === "function" ? require("./purchase-inventory-integrity.js") : null;

  function nextNumber(prefix, rows, pad = 4) {
    const max = rows.reduce((acc, item) => {
      const number = Number(String(item.batchId || item.id || "").replace(/\D/g, ""));
      return Number.isSafeInteger(number) ? Math.max(acc, number) : acc;
    }, 0);
    return `${prefix}${String(max + 1).padStart(pad, "0")}`;
  }

  function nextReturnNo(db, prefix) {
    const max = list(db, "returns").reduce((acc, item) => {
      const value = String(item.returnNo || item.returnInvoiceId || item.id || "");
      return value.startsWith(prefix) ? Math.max(acc, Number(value.replace(/\D/g, "")) || 1000) : acc;
    }, 1000);
    return `${prefix}${max + 1}`;
  }

  function documentReturns(db, kind, documentId) {
    const types = kind === "purchase" ? PURCHASE_TYPES : SALE_TYPES;
    return active(list(db, "returns")).filter(item => types.includes(item.type) && (item.documentId === documentId || (item.sourceDocuments || []).includes(documentId)));
  }

  function returnedQuantities(db, kind, documentId) {
    const map = new Map();
    for (const item of documentReturns(db, kind, documentId)) for (const line of item.items || item.lines || []) {
      if (line.documentId && line.documentId !== documentId) continue;
      if (line.sourceInvoiceId && line.sourceInvoiceId !== documentId) continue;
      const key = String(line.lineIndex ?? line.bookId ?? "");
      map.set(key, (map.get(key) || 0) + Number(line.qty || 0));
    }
    return map;
  }

  const returnedOf = (map, line, index) => Number(map.get(String(index)) || map.get(String(line.bookId)) || 0);

  // Net value of `qty` copies of a line, discounts included (same rules as the return screens).
  function lineNet(line, qty, priceField) {
    const sourceQty = Math.max(1, Number(line.qty || 1));
    if (line.finalNet != null) return Math.max(0, Number(line.finalNet || 0) / sourceQty * Number(qty || 0));
    const base = Number(qty || 0) * Number(line[priceField] || 0), discount = Number(line.discount || 0);
    if (line.discountType === "amount") return Math.max(0, base - (discount / sourceQty) * Number(qty || 0));
    return Math.max(0, base * (1 - discount / 100));
  }

  function fullyReturned(document, previous, selected) {
    return (document.lines || []).every((line, index) => returnedOf(previous, line, index) + Number(selected.find(row => row.lineIndex === index)?.qty || 0) >= Number(line.qty || 0));
  }

  function cashAccount(db, requested) {
    const accounts = active(list(db, "cashAccounts")).filter(item => item.active !== false);
    const text = String(requested || "").trim();
    return accounts.find(item => item.id === text || item.name === text) || accounts.find(item => item.name === "الخزينة الرئيسية") || { id: "", name: text || "الخزينة الرئيسية" };
  }

  function stockMovement(db, book, type, quantity, before, documentId, note, actor, now) {
    list(db, "stockMovements").push({ id: `MOV-${actor.uuid()}`, bookId: book.id, date: now, createdAt: now, type, quantity, before, after: Number(book.stock || 0), documentId, documentNo: documentId, note, user: actor.name || actor.username, username: actor.username });
  }

  // Validates and resolves the selected lines: [{ documentId, lineIndex, qty }] → lines with book, value and source.
  function resolveLines(db, kind, requested) {
    if (!Array.isArray(requested) || !requested.length) throw fail("حدد كمية لصنف واحد على الأقل.", "NO_LINES", 400);
    const documents = kind === "purchase" ? list(db, "purchases") : list(db, "sales");
    const picked = new Map();
    for (const input of requested) {
      const qty = Number(input?.qty);
      if (!Number.isInteger(qty) || qty < 0) throw fail("كمية المرتجع لازم تكون رقم صحيح.", "INVALID_QTY", 400);
      if (!qty) continue;
      const key = `${input.documentId}::${Number(input.lineIndex)}`;
      if (picked.has(key)) throw fail("البند مكرر في المرتجع.", "DUPLICATE_LINE", 400);
      picked.set(key, { documentId: String(input.documentId || ""), lineIndex: Number(input.lineIndex), qty });
    }
    if (!picked.size) throw fail("حدد كمية لصنف واحد على الأقل.", "NO_LINES", 400);
    const lines = [];
    for (const row of picked.values()) {
      const document = active(documents).find(item => item.id === row.documentId);
      const blocked = kind === "purchase" ? ["ملغاة", "مرتجع", "بانتظار الفحص"] : ["ملغاة", "مرتجع"];
      if (!document || blocked.includes(document.status)) throw fail(`المستند ${row.documentId} غير متاح للمرتجع.`, "DOCUMENT_NOT_RETURNABLE");
      if (kind === "sale" && document.refusal) throw fail("الفاتورة دي متسجل لها رفض استلام.", "DOCUMENT_NOT_RETURNABLE");
      const line = (document.lines || [])[row.lineIndex];
      if (!line?.bookId) throw fail("بند المرتجع غير موجود في المستند.", "LINE_NOT_FOUND", 400);
      const remaining = Number(line.qty || 0) - returnedOf(returnedQuantities(db, kind, document.id), line, row.lineIndex);
      if (row.qty > remaining) throw fail(`الكمية المرتجعة أكبر من المتاح في ${document.id} (${Math.max(0, remaining)}).`, "QTY_ABOVE_REMAINING", 400);
      const amount = round(lineNet(line, row.qty, kind === "purchase" ? "cost" : "price"));
      lines.push({ ...row, document, line, bookId: String(line.bookId), amount, unitValue: round(Number(line.qty || 0) ? lineNet(line, Number(line.qty), kind === "purchase" ? "cost" : "price") / Number(line.qty) : 0) });
    }
    return lines;
  }

  // ---- Sales returns -------------------------------------------------------------------------------------------

  // Copies coming back go into the batches they were sold from; anything beyond goes into a new "sales_return" batch.
  function restockSaleLine(db, sale, line, lineIndex, qty, actor, now, effects) {
    let left = qty;
    const allocations = (line.batchAllocations || []).map((allocation, index) => ({ allocation, index })).reverse();
    let lastCost = null;
    for (const { allocation, index } of allocations) {
      if (!(left > 0)) break;
      if (allocation.unitCost != null) lastCost = Number(allocation.unitCost);
      const batch = active(list(db, "inventoryBatches")).find(item => item.batchId === allocation.batchId || item.id === allocation.batchId);
      const take = Math.min(left, Math.max(0, Number(allocation.qty || 0) - Number(allocation.returnedQty || 0)));
      if (!batch || !(take > 0)) continue;
      batch.remainingQty = round(Number(batch.remainingQty || 0) + take);
      batch.updatedAt = now;
      allocation.returnedQty = Number(allocation.returnedQty || 0) + take;
      effects.batchRestores.push({ saleId: sale.id, lineIndex, allocationIndex: index, batchId: batch.batchId || batch.id, qty: take });
      left -= take;
    }
    if (left > 0) {
      const batches = active(list(db, "inventoryBatches")).filter(item => String(item.productId || item.bookId) === String(line.bookId));
      const held = batches.reduce((sum, item) => sum + Number(item.remainingQty || 0), 0);
      const averageCost = held > 0 ? batches.reduce((sum, item) => sum + Number(item.remainingQty || 0) * Number(item.unitCost || 0), 0) / held : 0;
      const book = list(db, "books").find(item => item.id === line.bookId);
      const unitCost = round(lastCost ?? (averageCost || Number(book?.cost || 0)));
      const id = nextNumber("BAT-", list(db, "inventoryBatches"));
      db.inventoryBatches.push({ id, batchId: id, productId: line.bookId, bookId: line.bookId, purchaseInvoiceId: sale.id, supplierId: book?.supplierId || "", receivedQty: left, remainingQty: left, unitCost, coverPrice: Number(book?.price || 0), purchaseDate: now.slice(0, 10), source: "sales_return", status: unitCost > 0 ? "active" : "cost_incomplete", createdAt: now, updatedAt: now, deletedAt: null });
      effects.createdBatches.push({ batchId: id, qty: left });
    }
  }

  function shipmentForSale(db, sale) {
    return active(list(db, "shipments")).find(item => item.invoiceId === sale.id || item.orderId === sale.id || (sale.onlineOrderId && item.onlineOrderId === sale.onlineOrderId)) || null;
  }

  // Paid money of an invoice already settled through the cancellation screen (orderRefunds: cash refund, credit,
  // linked disbursement, retained fee) — for the invoice or its order.
  function settledOutsideReturns(db, sale) {
    return list(db, "orderRefunds").filter(item => !item.deletedAt && !["reversed", "void"].includes(String(item.status || "")) && ["cash_refund", "customer_credit", "linked_disbursement", "retained_fee"].includes(item.settlementType)
      && (item.invoiceId === sale.id || (sale.onlineOrderId && item.orderId === sale.onlineOrderId))).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  }

  // Books the customer takes instead of the returned ones: [{ bookId, qty, discount (%) }] at the book's current price.
  // Copies of a book coming back in the same return count as available.
  function resolveReplacements(db, requested, returning) {
    if (!Array.isArray(requested) || !requested.length) return [];
    const merged = new Map();
    for (const input of requested) {
      const bookId = String(input?.bookId || ""), qty = Number(input?.qty), discount = Number(input?.discount || 0);
      if (!bookId || !qty) continue;
      if (!Number.isInteger(qty) || qty < 0) throw fail("كمية الكتاب البديل لازم تكون رقم صحيح.", "INVALID_REPLACEMENT_QTY", 400);
      if (!(discount >= 0 && discount <= 100)) throw fail("خصم الكتاب البديل لازم يكون من 0 لـ 100%.", "INVALID_REPLACEMENT_DISCOUNT", 400);
      const row = merged.get(bookId) || { bookId, qty: 0, discount };
      row.qty += qty; merged.set(bookId, row);
    }
    const lines = [];
    for (const row of merged.values()) {
      const book = active(list(db, "books")).find(item => item.id === row.bookId);
      if (!book) throw fail("الكتاب البديل غير موجود.", "REPLACEMENT_BOOK_NOT_FOUND", 400);
      const back = returning.filter(line => line.bookId === book.id).reduce((sum, line) => sum + line.qty, 0);
      const free = Number(book.stock || 0) + back - Math.max(0, Number(book.reservedStock || 0)) - Math.max(0, Number(book.countHoldQty || 0));
      if (row.qty > free) throw fail(`المتاح من «${book.name}» ${Math.max(0, free)} نسخة بس.`, "REPLACEMENT_STOCK_SHORT");
      lines.push({ bookId: book.id, qty: row.qty, price: Number(book.price || 0), discount: row.discount, discountType: "percent" });
    }
    return lines;
  }

  // The replacement is a real sales invoice: stock and batch costs leave like any sale, and the money the return owes
  // the customer pays for it (`paidFromReturn`); what it does not cover stays on the invoice as the customer's debt.
  function createReplacementSale(db, { lines, totals, applied, customer, firstSale, returnId, returnNo, operationKey, date, actor, now, effects }) {
    const id = nextNumber("INV-", list(db, "sales"));
    const payment = Finance.calculatePayment(totals.total, applied);
    const sale = {
      id, operationKey: `${operationKey}:replacement`, date, customerId: customer.id, channel: firstSale.channel || "", saleOperationType: "استبدال", status: "معتمدة",
      payment: "استبدال من مرتجع", paymentStatus: payment.paymentStatus, paid: payment.paidAmount, paidAmount: payment.paidAmount, paidFromReturn: payment.paidAmount,
      remaining: payment.remainingAmount, remainingAmount: payment.remainingAmount, subtotal: totals.subtotal, subtotalBeforeDiscount: totals.subtotalBeforeDiscount,
      productDiscountTotal: totals.productDiscountTotal, orderDiscount: 0, discount: totals.discountTotal, subtotalAfterDiscount: totals.goods, shipping: 0, shippingFee: 0, shippingCost: 0, total: totals.total,
      notes: `بديل في المرتجع ${returnNo}`, replacementForReturnId: returnId, replacementForReturnNo: returnNo,
      createdByName: actor.name || actor.username, createdByUsername: actor.username, pointsAwarded: 0, createdAt: now, updatedAt: now, deletedAt: null,
      lines: totals.lines.map(line => ({ ...line, productId: line.bookId, quantity: line.qty, originalPrice: line.price, unitSellingPrice: line.finalUnitPrice, totalSellingPrice: line.finalNet }))
    };
    for (const line of sale.lines) {
      const book = list(db, "books").find(item => item.id === line.bookId), before = Number(book.stock || 0);
      const costing = Inventory.consumeBatchesFIFO(db, book.id, line.qty);
      Object.assign(line, { costMethod: "FIFO", batchAllocations: costing.allocations, costIncomplete: costing.costIncomplete, costOfGoodsSold: costing.costIncomplete ? null : costing.costOfGoodsSold, grossProfit: costing.costIncomplete ? null : round(line.finalNet - costing.costOfGoodsSold) });
      book.stock = before - line.qty; book.lastSale = date; book.updatedAt = now;
      stockMovement(db, book, "بيع بديل في مرتجع", -line.qty, before, id, `بديل في المرتجع ${returnNo}`, actor, now);
    }
    list(db, "sales").push(sale);
    effects.replacementSaleId = id;
    return sale;
  }

  // payload: { customerId, invoiceId? (one invoice), lines:[{documentId,lineIndex,qty}], settlement, account,
  //            replacements:[{bookId,qty,discount}], returnShippingDeduction, reason, date, operationKey }
  // (replacementDeduction, a plain amount, is still accepted from pages opened before replacements existed.)
  function createSaleReturn(db, payload = {}, actor) {
    const operationKey = String(payload.operationKey || "").trim();
    if (!operationKey) throw fail("Operation Key مطلوب.", "OPERATION_KEY_REQUIRED", 400);
    const existing = list(db, "returns").find(item => item.operationKey === operationKey);
    if (existing) return { existing: true, record: existing };
    const settlement = String(payload.settlement || "cash");
    if (!["cash", "customer-credit", "debt-only", "no-settlement"].includes(settlement)) throw fail("اختر طريقة تسوية صحيحة.", "INVALID_SETTLEMENT", 400);
    const lines = resolveLines(db, "sale", payload.lines);
    const customerId = String(lines[0].document.customerId || "");
    const customer = active(list(db, "customers")).find(item => item.id === customerId);
    if (!customer) throw fail("لا يمكن تسجيل مرتجع إلا لفاتورة مرتبطة بعميل مسجل.", "CUSTOMER_REQUIRED", 400);
    if (lines.some(line => line.document.customerId !== customerId) || (payload.customerId && payload.customerId !== customerId)) throw fail("كل البنود لازم تكون من فواتير نفس العميل.", "MIXED_CUSTOMERS", 400);
    const singleInvoice = Boolean(payload.invoiceId);
    if (singleInvoice && lines.some(line => line.documentId !== payload.invoiceId)) throw fail("البنود لازم تكون من الفاتورة المختارة.", "WRONG_INVOICE", 400);
    const now = actor.now || new Date().toISOString(), date = String(payload.date || now).slice(0, 10), reason = String(payload.reason || "").trim();
    if (!reason) throw fail("سبب المرتجع مطلوب.", "REASON_REQUIRED", 400);

    // Per invoice: the part of the returned value that clears what is still owed, the rest is due to the customer.
    const perSale = new Map();
    for (const line of lines) {
      const row = perSale.get(line.documentId) || { sale: line.document, lines: [], amount: 0 };
      row.lines.push(line); row.amount = round(row.amount + line.amount); perSale.set(line.documentId, row);
    }
    for (const row of perSale.values()) {
      const sale = row.sale, total = Math.max(1, Number(sale.total || 0));
      row.debt = Math.min(Number(sale.remaining || 0), (Number(sale.remaining || 0) + Number(sale.returnedRemaining || 0)) * row.amount / total);
      // Money already given back for this invoice outside returns (a cancellation refund or credit) is not paid again.
      row.due = Math.max(0, Math.min(row.amount - row.debt, Number(sale.paid || 0) - settledOutsideReturns(db, sale)));
    }
    const amount = round([...perSale.values()].reduce((sum, row) => sum + row.amount, 0));
    const debt = [...perSale.values()].reduce((sum, row) => sum + row.debt, 0), dueBefore = [...perSale.values()].reduce((sum, row) => sum + row.due, 0);
    const replacementLines = resolveReplacements(db, payload.replacements, lines);
    const replacementTotals = replacementLines.length ? Finance.calculateOrder(replacementLines) : null;
    let replacement, shipping, fromDue, fromDebt;
    if (replacementTotals) {
      // Return shipping comes out of the money due first (then the debt being cleared); what is left pays for the
      // replacement books, and the rest of their price goes on the replacement invoice.
      shipping = Math.max(0, Math.min(Number(payload.returnShippingDeduction || 0), amount));
      fromDue = Math.min(shipping, dueBefore); fromDebt = Math.min(shipping - fromDue, debt);
      replacement = Math.min(replacementTotals.total, dueBefore - fromDue);
    } else {
      replacement = Math.max(0, Math.min(Number(payload.replacementDeduction || 0), Math.max(0, dueBefore)));
      // Return shipping the customer bears comes out of the money due first, then out of the debt being cleared.
      shipping = Math.max(0, Math.min(Number(payload.returnShippingDeduction || 0), Math.max(0, amount - replacement)));
      fromDue = Math.min(shipping, Math.max(0, dueBefore - replacement)); fromDebt = Math.min(shipping - fromDue, debt);
    }
    const customerDue = Math.max(0, dueBefore - replacement - fromDue), debtReduction = debt - fromDebt;
    const account = settlement === "cash" ? cashAccount(db, payload.account) : null;

    const records = list(db, "returns");
    const returnId = nextNumber("RET-", records);
    const returnNo = singleInvoice ? `RINV-${returnId.replace(/\D/g, "").padStart(3, "0")}` : nextReturnNo(db, "SR-");
    const effects = { stock: [], batchRestores: [], createdBatches: [], cashTxIds: [], balanceDelta: 0, pointsDeducted: 0, sales: [], orders: [], shipments: [] };

    for (const line of lines) {
      const book = list(db, "books").find(item => item.id === line.bookId);
      restockSaleLine(db, line.document, line.line, line.lineIndex, line.qty, actor, now, effects);
      if (book) {
        const before = Number(book.stock || 0);
        book.stock = before + line.qty; book.updatedAt = now;
        stockMovement(db, book, "مرتجع مبيعات", line.qty, before, singleInvoice ? line.documentId : returnNo, singleInvoice ? reason : `مرتجع من فاتورة ${line.documentId}`, actor, now);
        effects.stock.push({ bookId: book.id, qty: line.qty });
      }
    }

    const replacementSale = replacementTotals ? createReplacementSale(db, { lines: replacementLines, totals: replacementTotals, applied: round(replacement), customer, firstSale: lines[0].document, returnId, returnNo, operationKey, date, actor, now, effects }) : null;

    const balanceBefore = Number(customer.balance || 0);
    let balance = balanceBefore - debtReduction;
    if (settlement === "customer-credit" || settlement === "no-settlement") balance -= customerDue;
    if (settlement === "debt-only") balance = Math.max(0, balance - customerDue);
    // What the return itself credits on the statement (the invoices' own rows show the debt cleared and added).
    const statementCredit = round(balanceBefore - debtReduction - balance);
    if (replacementSale) balance += Number(replacementSale.remaining || 0);
    customer.balance = round(balance);
    effects.balanceDelta = round(customer.balance - balanceBefore);

    const debtShare = debt > 0 ? debtReduction / debt : 1;
    const paidOut = customerDue + replacement;
    for (const row of perSale.values()) {
      const sale = row.sale, previous = returnedQuantities(db, "sale", sale.id);
      const isFull = fullyReturned(sale, previous, row.lines);
      const saleDebt = row.debt * debtShare, salePaid = dueBefore > 0 ? paidOut * row.due / dueBefore : 0;
      // Paid money that moved to the replacement invoice is not a refund: it is kept apart from returnedPaid so
      // collections (paid + returnedPaid) count it once, on the replacement invoice.
      const exchanged = replacementSale && dueBefore > 0 ? Math.min(salePaid, replacement * row.due / dueBefore) : 0;
      const points = Math.floor(Number(sale.pointsAwarded || 0) * row.amount / Math.max(1, Number(sale.total || 0)));
      if (points) { const before = Number(customer.points || 0); customer.points = Math.max(0, before - points); effects.pointsDeducted += before - customer.points; }
      const snapshot = { id: sale.id, status: sale.status, returnedAt: sale.returnedAt || null, returnReason: sale.returnReason || "" };
      const paidDelta = Math.min(Number(sale.paid || 0), salePaid), remainingDelta = Math.min(Number(sale.remaining || 0), saleDebt);
      Object.assign(sale, {
        status: isFull ? "مرتجع" : "مرتجع جزئي",
        paid: round(Number(sale.paid || 0) - paidDelta), remaining: round(Number(sale.remaining || 0) - remainingDelta),
        returnedPaid: round(Number(sale.returnedPaid || 0) + paidDelta - Math.min(exchanged, paidDelta)), returnedRemaining: round(Number(sale.returnedRemaining || 0) + remainingDelta),
        ...(exchanged > 0 ? { exchangedPaid: round(Number(sale.exchangedPaid || 0) + Math.min(exchanged, paidDelta)) } : {}),
        returnedAt: now, returnReason: reason, updatedAt: now
      });
      effects.sales.push({ ...snapshot, paidDelta: round(paidDelta), remainingDelta: round(remainingDelta), exchangedDelta: round(Math.min(exchanged, paidDelta)) });
      if (isFull) {
        const shipment = shipmentForSale(db, sale);
        if (shipment) {
          effects.shipments.push({ id: shipment.id, status: shipment.status, currentStatus: shipment.currentStatus, normalizedStatus: shipment.normalizedStatus, shippingStatus: shipment.shippingStatus });
          // Tracking reads the normalized status: without it the parcel keeps being tracked and can flip the order back.
          Object.assign(shipment, { status: "مرتجع", currentStatus: "مرتجع", normalizedStatus: "returned", shippingStatus: "returned", updated: now, updatedAt: now });
        }
        const order = sale.onlineOrderId && list(db, "onlineOrders").find(item => item.id === sale.onlineOrderId);
        if (order) {
          effects.orders.push({ id: order.id, status: order.status, workflowStage: order.workflowStage });
          Object.assign(order, { status: "مرتجع", workflowStage: "returned", updatedAt: now });
        }
      }
    }

    if (settlement === "cash" && customerDue > 0) {
      const tx = { id: nextNumber("TX-", list(db, "cash")), date, type: "صرف", direction: "out", locked: true, account: account.name, accountId: account.id, party: customer.name || "عميل", customerId, amount: round(customerDue), category: "مرتجع مبيعات", note: `فاتورة مرتجع ${returnNo}${singleInvoice ? ` من ${lines[0].documentId}` : ""} — ${reason}`, returnId, createdAt: now, createdBy: actor.name || actor.username, status: "معتمد" };
      db.cash.push(tx); effects.cashTxIds.push(tx.id);
    }

    const sourceDocuments = [...perSale.keys()];
    const record = {
      id: returnId, returnNo, returnInvoiceId: returnNo, type: "sales_return", mode: singleInvoice ? "from_invoice" : "by_account", accountType: "customer", accountId: customerId, partyId: customerId,
      documentId: sourceDocuments.length === 1 ? sourceDocuments[0] : "متعدد", sourceDocuments, date,
      items: lines.map(line => ({ bookId: line.bookId, documentId: line.documentId, sourceInvoiceId: line.documentId, sourceInvoiceNo: line.documentId, lineIndex: line.lineIndex, qty: line.qty, unitPrice: line.unitValue, total: line.amount, reason })),
      subtotal: round(amount - shipping), amount: round(amount - shipping), debtReduction: round(debtReduction), replacementDeduction: round(replacement), returnShippingDeduction: round(fromDue + fromDebt),
      ...(replacementSale ? { replacementSaleId: replacementSale.id, replacementTotal: replacementSale.total, replacementRemaining: replacementSale.remaining, replacementItems: replacementSale.lines.map(line => ({ bookId: line.bookId, qty: line.qty, unitPrice: line.finalUnitPrice, total: line.finalNet })) } : {}),
      statementCredit,
      customerDue: round(customerDue), settlementType: settlement, settlement, paidAmount: settlement === "cash" ? round(customerDue) : 0, balanceEffect: effects.balanceDelta,
      account: account?.name || "", reason, notes: "", operationKey, effects, createdBy: actor.name || actor.username, createdByUsername: actor.username, createdAt: now, updatedAt: now, status: "معتمد", deletedAt: null
    };
    records.push(record);
    return { existing: false, record };
  }

  // ---- Purchase returns ----------------------------------------------------------------------------------------

  // Returned books leave the batches too: the purchase's own batch first, the oldest batches for the rest.
  function takeFromBatches(db, purchase, line, lineIndex, qty, now, effects) {
    const batches = active(list(db, "inventoryBatches")).filter(item => String(item.productId || item.bookId) === String(line.bookId));
    if (!batches.length) return;
    let left = qty;
    const own = purchase.lines?.[lineIndex]?.batchId && batches.find(item => (item.batchId || item.id) === purchase.lines[lineIndex].batchId);
    const order = [own, ...batches.filter(item => item !== own && Number(item.remainingQty || 0) > 0).sort((a, b) => String(a.purchaseDate || a.createdAt || "").localeCompare(String(b.purchaseDate || b.createdAt || "")))].filter(Boolean);
    if (order.reduce((sum, item) => sum + Number(item.remainingQty || 0), 0) + 1e-6 < left) throw fail("كميات الدفعات في المخزن أقل من المرتجع؛ راجع جرد الصنف قبل تسجيل مرتجع المورد.", "INSUFFICIENT_BATCH_STOCK");
    for (const batch of order) {
      if (!(left > 0)) break;
      const take = Math.min(left, Number(batch.remainingQty || 0));
      if (!(take > 0)) continue;
      batch.remainingQty = round(Number(batch.remainingQty || 0) - take); batch.updatedAt = now;
      effects.batchTakes.push({ batchId: batch.batchId || batch.id, qty: take });
      left -= take;
    }
  }

  // payload: { supplierId, purchaseId? (one document), lines, settlement (by account only), account, reason, notes,
  //            supplierInvoiceNumber, supplierReturnInvoiceNumber, date, operationKey }
  function createPurchaseReturn(db, payload = {}, actor) {
    const operationKey = String(payload.operationKey || "").trim();
    if (!operationKey) throw fail("Operation Key مطلوب.", "OPERATION_KEY_REQUIRED", 400);
    const existing = list(db, "returns").find(item => item.operationKey === operationKey);
    if (existing) return { existing: true, record: existing };
    const lines = resolveLines(db, "purchase", payload.lines);
    const supplierId = String(lines[0].document.supplierId || "");
    const supplier = active(list(db, "suppliers")).find(item => item.id === supplierId);
    if (!supplier) throw fail("يجب اختيار مورد مسجل لمرتجع المشتريات.", "SUPPLIER_REQUIRED", 400);
    if (lines.some(line => line.document.supplierId !== supplierId) || (payload.supplierId && payload.supplierId !== supplierId)) throw fail("كل البنود لازم تكون من مستندات نفس المورد.", "MIXED_SUPPLIERS", 400);
    const single = Boolean(payload.purchaseId);
    if (single && lines.some(line => line.documentId !== payload.purchaseId)) throw fail("البنود لازم تكون من المستند المختار.", "WRONG_DOCUMENT", 400);
    const settlement = single ? "auto" : String(payload.settlement || "account-credit");
    if (!single && !["cash", "account-credit"].includes(settlement)) throw fail("اختر طريقة تسوية صحيحة.", "INVALID_SETTLEMENT", 400);
    const now = actor.now || new Date().toISOString(), date = String(payload.date || now).slice(0, 10), reason = String(payload.reason || "").trim();
    // Only free copies can go back to the supplier: copies reserved for confirmed orders or held for a stock count stay.
    // Lines are added up per book, so two lines of the same book cannot each pass on their own.
    const requested = new Map();
    for (const line of lines) requested.set(line.bookId, (requested.get(line.bookId) || 0) + Number(line.qty || 0));
    for (const [bookId, qty] of requested) {
      const book = list(db, "books").find(item => item.id === bookId);
      if (!book) continue;
      const stock = Number(book.stock || 0), held = Math.max(0, Number(book.reservedStock || 0)) + Math.max(0, Number(book.countHoldQty || 0));
      if (stock < qty) throw fail(`لا يمكن تسجيل المرتجع لأن رصيد «${book.name}» أقل من الكمية المطلوبة.`, "INSUFFICIENT_STOCK");
      if (stock - held < qty) throw fail(`المتاح من «${book.name}» ${Math.max(0, stock - held)} بس؛ باقي النسخ محجوزة لطلبات مؤكدة أو بانتظار الجرد. ألغِ الحجز أو قلّل الكمية.`, "RESERVED_STOCK_UNAVAILABLE");
    }
    const records = list(db, "returns");
    const returnId = nextNumber("RET-", records);
    const returnNo = String(payload.supplierReturnInvoiceNumber || "").trim() || nextReturnNo(db, "PR-");
    const effects = { stock: [], batchTakes: [], cashTxIds: [], balanceDelta: 0, purchases: [] };
    for (const line of lines) takeFromBatches(db, line.document, line.line, line.lineIndex, line.qty, now, effects);
    for (const line of lines) {
      const book = list(db, "books").find(item => item.id === line.bookId);
      if (!book) continue;
      const before = Number(book.stock || 0);
      book.stock = before - line.qty; book.updatedAt = now;
      stockMovement(db, book, line.document.type === "أمانة" ? "مرتجع أمانة" : single ? "مرتجع مشتريات" : "مرتجع مشتريات مستقل", -line.qty, before, single ? line.documentId : returnNo, reason || "مرتجع مشتريات", actor, now);
      effects.stock.push({ bookId: book.id, qty: line.qty });
    }

    // Consignment (أمانة) stock never raised what we owe the supplier, so returning it moves no money.
    const perPurchase = new Map();
    for (const line of lines) {
      const row = perPurchase.get(line.documentId) || { purchase: line.document, lines: [], amount: 0 };
      row.lines.push(line); row.amount = round(row.amount + line.amount); perPurchase.set(line.documentId, row);
    }
    const amount = round(lines.reduce((sum, line) => sum + line.amount, 0));
    const moneyAmount = round([...perPurchase.values()].filter(row => row.purchase.type !== "أمانة").reduce((sum, row) => sum + row.amount, 0));
    const balanceBefore = Number(supplier.balance || 0);
    let cashIn = 0, totalReduction = 0;
    for (const row of perPurchase.values()) {
      const purchase = row.purchase, total = Math.max(1, Number(purchase.total || 0)), consignment = purchase.type === "أمانة";
      const reduction = consignment ? 0 : Math.min(Number(purchase.remaining || 0), (Number(purchase.remaining || 0) + Number(purchase.returnedRemaining || 0)) * row.amount / total);
      const refund = consignment ? 0 : single
        ? Math.min(Number(purchase.paid || 0), (Number(purchase.paid || 0) + Number(purchase.returnedPaid || 0)) * row.amount / total)
        : settlement === "cash" && moneyAmount > 0 ? Math.min(Number(purchase.paid || 0), moneyAmount * row.amount / moneyAmount) : 0;
      cashIn += refund; totalReduction += reduction;
      const isFull = fullyReturned(purchase, returnedQuantities(db, "purchase", purchase.id), row.lines);
      effects.purchases.push({ id: purchase.id, status: purchase.status, returnedAt: purchase.returnedAt || null, returnReason: purchase.returnReason || "", paidDelta: round(refund), remainingDelta: round(reduction) });
      Object.assign(purchase, {
        status: isFull ? "مرتجع" : "مرتجع جزئي", paid: round(Number(purchase.paid || 0) - refund), remaining: round(Number(purchase.remaining || 0) - reduction),
        returnedPaid: round(Number(purchase.returnedPaid || 0) + refund), returnedRemaining: round(Number(purchase.returnedRemaining || 0) + reduction), returnedAt: now, returnReason: reason, updatedAt: now
      });
    }
    // One document: its debt shrinks and the paid share comes back in cash. By account: the chosen settlement.
    const cash = single ? round(cashIn) : settlement === "cash" ? moneyAmount : 0;
    const balanceChange = single ? -totalReduction : settlement === "cash" ? 0 : -moneyAmount;
    supplier.balance = round(single ? Math.max(0, balanceBefore + balanceChange) : balanceBefore + balanceChange);
    effects.balanceDelta = round(supplier.balance - balanceBefore);
    const account = cash > 0 ? cashAccount(db, payload.account) : null;
    if (cash > 0) {
      const tx = { id: nextNumber("TX-", list(db, "cash")), date, type: "قبض", direction: "in", locked: true, account: account.name, accountId: account.id, party: supplier.name || "مورد", supplierId, amount: round(cash), category: "مرتجع مشتريات", note: `مرتجع ${returnNo} — ${reason}`, returnId, createdAt: now, createdBy: actor.name || actor.username, status: "معتمد" };
      db.cash.push(tx); effects.cashTxIds.push(tx.id);
    }
    const sourceDocuments = [...perPurchase.keys()];
    const record = {
      id: returnId, returnNo, returnInvoiceId: returnNo, type: "purchase_return", mode: single ? "from_invoice" : "by_account", accountType: "supplier", accountId: supplierId, partyId: supplierId,
      documentId: sourceDocuments.length === 1 ? sourceDocuments[0] : "متعدد", sourceDocuments,
      supplierInvoiceNumber: String(payload.supplierInvoiceNumber || lines[0].document.supplierInvoiceNumber || ""), supplierReturnInvoiceNumber: String(payload.supplierReturnInvoiceNumber || ""), date,
      items: lines.map(line => ({ bookId: line.bookId, documentId: line.documentId, sourceInvoiceId: line.documentId, sourceInvoiceNo: line.document.supplierInvoiceNumber || line.documentId, lineIndex: line.lineIndex, qty: line.qty, unitPrice: line.unitValue, total: line.amount, reason })),
      subtotal: amount, amount, settlementType: single ? (cash > 0 ? "cash" : "account-credit") : settlement, settlement: single ? (cash > 0 ? "cash" : "account-credit") : settlement,
      paidAmount: round(cash), balanceEffect: effects.balanceDelta, remainingReduction: round(totalReduction), supplierDue: single ? 0 : settlement === "cash" ? 0 : moneyAmount,
      account: account?.name || "", reason, notes: String(payload.notes || ""), operationKey, effects, createdBy: actor.name || actor.username, createdByUsername: actor.username, createdAt: now, updatedAt: now, status: "معتمد", deletedAt: null
    };
    records.push(record);
    return { existing: false, record };
  }

  // ---- Reversal ------------------------------------------------------------------------------------------------

  // Undoes a return created by this module, exactly as recorded in its `effects`. Refused deliveries, repaired
  // returns and returns recorded before (no `effects`) are not reversible here.
  function reverseReturn(db, returnId, payload = {}, actor) {
    const record = list(db, "returns").find(item => item.id === returnId);
    if (!record) throw fail("المرتجع غير موجود.", "RETURN_NOT_FOUND", 404);
    if (record.reversedAt) return { existing: true, record };
    if (record.deletedAt) throw fail("المرتجع ده محذوف.", "RETURN_DELETED");
    if (record.mode === "refusal" || record.refusalRepaired) throw fail("رفض الاستلام ميتلغيش من هنا.", "RETURN_NOT_REVERSIBLE");
    if (!record.effects) throw fail("المرتجع ده اتسجل قبل إضافة الإلغاء، فمينفعش يتلغي من السيستم.", "RETURN_NOT_REVERSIBLE");
    const reason = String(payload.reason || "").trim();
    if (!reason) throw fail("اكتب سبب إلغاء المرتجع.", "REASON_REQUIRED", 400);
    const sale = record.type === "sales_return";
    const effects = record.effects, now = actor.now || new Date().toISOString();
    const docs = sale ? list(db, "sales") : list(db, "purchases");
    // A later return on the same document is built on this one; undo the latest first.
    const position = list(db, "returns").indexOf(record);
    for (const id of record.sourceDocuments || []) {
      const later = documentReturns(db, sale ? "sale" : "purchase", id).filter(item => list(db, "returns").indexOf(item) > position);
      if (later.length) throw fail(`فيه مرتجع أحدث على ${id} (${later.map(item => item.returnNo || item.id).join("، ")}). ألغيه الأول.`, "LATER_RETURN_EXISTS");
    }
    // Checks before any change: the stock and batches must still hold what is taken back.
    const books = list(db, "books"), batches = list(db, "inventoryBatches");
    if (sale) {
      // Added up per book and per batch: a return from two invoices of the same book has a row for each, and each row
      // alone could pass while together they take more than is left.
      const perBook = new Map(), perBatch = new Map();
      for (const row of effects.stock) perBook.set(row.bookId, (perBook.get(row.bookId) || 0) + Number(row.qty || 0));
      for (const row of [...effects.batchRestores, ...effects.createdBatches]) perBatch.set(row.batchId, (perBatch.get(row.batchId) || 0) + Number(row.qty || 0));
      // Copies of the replacement invoice come back to stock in the same step.
      const replaced = effects.replacementSaleId ? list(db, "sales").find(item => item.id === effects.replacementSaleId && item.status !== "ملغاة") : null;
      for (const [bookId, qty] of perBook) {
        const book = books.find(item => item.id === bookId); if (!book) continue;
        const free = (replaced?.lines || []).filter(line => line.bookId === bookId).reduce((sum, line) => sum + Number(line.qty || 0), 0) + Number(book.stock || 0) - Math.max(0, Number(book.reservedStock || 0)) - Math.max(0, Number(book.countHoldQty || 0));
        if (free + 1e-6 < qty) throw fail(`الكتب اللي رجعت من «${book.name}» اتباعت تاني أو اتحجزت؛ المتاح دلوقتي ${Math.max(0, free)} والمرتجع ${qty}.`, "STOCK_ALREADY_USED");
      }
      for (const [batchId, qty] of perBatch) { const batch = batches.find(item => (item.batchId || item.id) === batchId); if (batch && Number(batch.remainingQty || 0) + 1e-6 < qty) throw fail("الكتب اللي رجعت بالمرتجع ده اتباعت تاني من نفس الدفعة؛ مينفعش يتلغي.", "STOCK_ALREADY_USED"); }
    }
    // The replacement invoice is cancelled with the return, only while nothing else was done on it.
    const replacementSale = sale && effects.replacementSaleId ? list(db, "sales").find(item => item.id === effects.replacementSaleId) : null;
    if (replacementSale && replacementSale.status !== "ملغاة") {
      if (documentReturns(db, "sale", replacementSale.id).length) throw fail(`الفاتورة البديلة ${replacementSale.id} عليها مرتجع؛ ألغيه الأول.`, "REPLACEMENT_HAS_RETURN");
      if (round(Number(replacementSale.paid || 0)) !== round(Number(replacementSale.paidFromReturn || 0))) throw fail(`الفاتورة البديلة ${replacementSale.id} اتدفع عليها فلوس بعد المرتجع؛ سوّيها الأول.`, "REPLACEMENT_PAID");
    }
    const party = active(list(db, sale ? "customers" : "suppliers")).find(item => item.id === record.partyId);
    if (replacementSale && replacementSale.status !== "ملغاة") {
      for (const line of replacementSale.lines || []) {
        Inventory.restoreBatchAllocations(db, line.batchAllocations || []);
        const book = books.find(item => item.id === line.bookId); if (!book) continue;
        const before = Number(book.stock || 0); book.stock = before + Number(line.qty || 0); book.updatedAt = now;
        stockMovement(db, book, "إلغاء بيع بديل", Number(line.qty || 0), before, replacementSale.id, `إلغاء المرتجع ${record.returnNo} — ${reason}`, actor, now);
      }
      // The balance change below (effects.balanceDelta) already takes its remaining off the customer's account.
      Object.assign(replacementSale, { status: "ملغاة", cancelledAt: now, voidedAt: now, voidedBy: actor.name || actor.username, voidedByUsername: actor.username, cancelReason: `إلغاء المرتجع ${record.returnNo}`, paid: 0, paidAmount: 0, remaining: 0, remainingAmount: 0, updatedAt: now });
    }
    // Stock and batches.
    for (const row of effects.stock) {
      const book = books.find(item => item.id === row.bookId); if (!book) continue;
      const before = Number(book.stock || 0); book.stock = before + (sale ? -row.qty : row.qty); book.updatedAt = now;
      stockMovement(db, book, sale ? "إلغاء مرتجع مبيعات" : "إلغاء مرتجع مشتريات", sale ? -row.qty : row.qty, before, record.returnNo, reason, actor, now);
    }
    if (sale) {
      for (const row of effects.batchRestores) {
        const batch = batches.find(item => (item.batchId || item.id) === row.batchId);
        if (batch) { batch.remainingQty = round(Number(batch.remainingQty || 0) - row.qty); batch.updatedAt = now; }
        const allocation = docs.find(item => item.id === row.saleId)?.lines?.[row.lineIndex]?.batchAllocations?.[row.allocationIndex];
        if (allocation) allocation.returnedQty = Math.max(0, Number(allocation.returnedQty || 0) - row.qty);
      }
      for (const row of effects.createdBatches) { const batch = batches.find(item => (item.batchId || item.id) === row.batchId); if (batch) { batch.remainingQty = round(Number(batch.remainingQty || 0) - row.qty); batch.updatedAt = now; } }
    } else {
      for (const row of effects.batchTakes) { const batch = batches.find(item => (item.batchId || item.id) === row.batchId); if (batch) { batch.remainingQty = round(Number(batch.remainingQty || 0) + row.qty); batch.updatedAt = now; } }
    }
    // Money: the balance change and every cash entry are cancelled by opposite ones.
    if (party) party.balance = round(Number(party.balance || 0) - Number(effects.balanceDelta || 0));
    if (sale && party && effects.pointsDeducted) party.points = Number(party.points || 0) + effects.pointsDeducted;
    const reversals = [];
    for (const id of effects.cashTxIds || []) {
      const tx = list(db, "cash").find(item => item.id === id); if (!tx || tx.reversedBy) continue;
      const reversal = { id: nextNumber("TX-", db.cash), date: now.slice(0, 10), type: tx.type === "صرف" ? "قبض" : "صرف", direction: tx.type === "صرف" ? "in" : "out", locked: true, account: tx.account, accountId: tx.accountId || "", party: tx.party, amount: tx.amount, category: `إلغاء ${tx.category}`, returnId: record.id, reversesId: tx.id, note: `إلغاء المرتجع ${record.returnNo} — ${reason}`, createdAt: now, createdBy: actor.name || actor.username, status: "معتمد" };
      db.cash.push(reversal); tx.reversedBy = reversal.id; reversals.push(reversal.id);
    }
    // Documents, orders and shipments go back to what they were, unless another return still applies.
    for (const row of (sale ? effects.sales : effects.purchases) || []) {
      const document = docs.find(item => item.id === row.id); if (!document) continue;
      const stillReturned = documentReturns(db, sale ? "sale" : "purchase", document.id).some(item => item.id !== record.id);
      Object.assign(document, {
        paid: round(Number(document.paid || 0) + row.paidDelta), remaining: round(Number(document.remaining || 0) + row.remainingDelta),
        returnedPaid: round(Math.max(0, Number(document.returnedPaid || 0) - row.paidDelta + Number(row.exchangedDelta || 0))), returnedRemaining: round(Math.max(0, Number(document.returnedRemaining || 0) - row.remainingDelta)),
        ...(row.exchangedDelta ? { exchangedPaid: round(Math.max(0, Number(document.exchangedPaid || 0) - row.exchangedDelta)) } : {}),
        status: stillReturned ? "مرتجع جزئي" : row.status, returnedAt: stillReturned ? document.returnedAt : row.returnedAt, returnReason: stillReturned ? document.returnReason : row.returnReason, updatedAt: now
      });
    }
    for (const row of effects.orders || []) { const order = list(db, "onlineOrders").find(item => item.id === row.id); if (order && order.status === "مرتجع" && !order.refusal) Object.assign(order, { status: row.status, workflowStage: row.workflowStage, updatedAt: now }); }
    for (const row of effects.shipments || []) { const shipment = list(db, "shipments").find(item => item.id === row.id); if (shipment && shipment.status === "مرتجع" && !shipment.refusedAt) Object.assign(shipment, { status: row.status, currentStatus: row.currentStatus, normalizedStatus: row.normalizedStatus, shippingStatus: row.shippingStatus, updated: now, updatedAt: now }); }
    // The record stays for history; deletedAt keeps every screen and report from counting it again.
    Object.assign(record, { status: "ملغى", reversedAt: now, reversedBy: actor.name || actor.username, reversedByUsername: actor.username, reversalReason: reason, reversalCashTxIds: reversals, deletedAt: now, updatedAt: now });
    return { existing: false, record };
  }

  return { createSaleReturn, createPurchaseReturn, reverseReturn, lineNet, returnedQuantities };
});
