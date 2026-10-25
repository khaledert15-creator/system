(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DuplicateOrders = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // Shipped orders stay visible as information for this many days so the employee can tell the customer.
  const RECENT_SHIPPED_DAYS = 7;
  const MIN_REASON_LENGTH = 5;

  function normalizePhone(value = "") {
    let digits = String(value || "").replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/\D/g, "");
    if (digits.startsWith("0020")) digits = digits.slice(4);
    else if (digits.startsWith("20") && digits.length === 12) digits = digits.slice(2);
    if (digits.length === 10 && digits.startsWith("1")) digits = `0${digits}`;
    return digits.length >= 10 ? digits : "";
  }

  // Customers spell the same name differently across chats; only letters that are commonly swapped are folded.
  function normalizeName(value = "") {
    return String(value || "").trim().toLowerCase()
      .replace(/[ً-ْـ]/g, "")
      .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
      .replace(/\s+/g, " ");
  }

  function normalizePlace(value = "") {
    return normalizeName(value).replace(/^محافظه\s+/, "").replace(/\s/g, "");
  }

  // open: may still be merged with the new request. packed: open, but the packing employee must reopen it first.
  // recent_shipped: information only. Anything else (cancelled, returned, delivered, old shipments) is ignored.
  function orderState(order = {}, now = Date.now()) {
    const status = String(order.status || "").toLowerCase();
    if (order.deletedAt || order.cancelledAt || ["cancelled", "returned", "delivered"].includes(order.workflowStage) || ["ملغي", "مرتجع", "تم التسليم", "cancelled", "canceled", "returned"].includes(status)) return "";
    if (order.workflowStage === "shipped" || order.shipmentId || ["تم الشحن", "تم إنشاء الشحنة", "خرج للتوصيل"].includes(order.status)) {
      const shippedAt = new Date(order.shippedAt || order.updatedAt || order.createdAt || 0).getTime();
      return now - shippedAt <= RECENT_SHIPPED_DAYS * 86400000 ? "recent_shipped" : "";
    }
    if (order.workflowStage === "awaiting_shipping" || order.workflowStage === "awaiting_packing" || order.preparedAt) return "packed";
    return "open";
  }

  function stageLabel(order = {}) {
    const state = orderState(order);
    if (state === "recent_shipped") return "تم الشحن";
    if (state === "packed") return "مغلّف · منتظر كود التتبع";
    return ({ draft: "مسودة لم تتأكد", awaiting_preparation: "مؤكد · منتظر التجهيز", awaiting_stock: "حجز مسبق", preparing: "جاري التجهيز", needs_review: "يحتاج مراجعة" })[order.workflowStage] || "طلب جديد";
  }

  // strong: a phone of the new request equals a phone on the order (main, alternative or the chat's WhatsApp number,
  // either way round), or both come from the same Chatwood contact.
  // weak: different phones but the same name in the same governorate, the usual sign of a second chat.
  function findCustomerOrders(orders = [], input = {}, options = {}) {
    const now = options.now || Date.now();
    const phones = new Set([input.phone, input.alternativePhone, input.whatsAppPhone].map(normalizePhone).filter(Boolean));
    const contactId = String(input.chatwootContactId || "").trim();
    const name = normalizeName(input.customerName), governorate = normalizePlace(input.governorate);
    const matches = [];
    for (const order of orders || []) {
      if (!order || order.id === options.excludeOrderId) continue;
      const state = orderState(order, now);
      if (!state) continue;
      const orderPhones = [order.phone, order.alternativePhone, order.customerWhatsAppPhone].map(normalizePhone).filter(Boolean);
      let strength = "";
      if (orderPhones.some(phone => phones.has(phone)) || (input.customerId && order.customerId === input.customerId) || (contactId && String(order.chatwootContactId || "") === contactId)) strength = "strong";
      else if (name && name.length >= 5 && normalizeName(order.customerName) === name && governorate && normalizePlace(order.governorate) === governorate) strength = "weak";
      if (!strength) continue;
      matches.push({ order, state, strength, label: stageLabel(order) });
    }
    const rank = { open: 0, packed: 1, recent_shipped: 2 };
    return matches.sort((a, b) => rank[a.state] - rank[b.state] || new Date(b.order.createdAt || 0) - new Date(a.order.createdAt || 0));
  }

  // Only orders that can still be merged need a decision; recently shipped ones are shown but never block.
  function blockingMatches(matches = []) {
    return matches.filter(match => match.state === "open" || match.state === "packed");
  }

  function validReason(reason = "") {
    return String(reason || "").trim().length >= MIN_REASON_LENGTH;
  }

  // Orders that came back without being received: recorded refusals, and older orders the tracking marked returned.
  function isRefusedOrder(order = {}) {
    return Boolean(order.refusal) || order.workflowStage === "returned" || ["مرتجع", "returned"].includes(String(order.status || "").toLowerCase());
  }

  // Only the same phone (main or alternative) or the same customer record counts; a name alone is not enough to label someone.
  function findRefusalHistory(orders = [], input = {}, options = {}) {
    const phones = new Set([input.phone, input.alternativePhone].map(normalizePhone).filter(Boolean));
    if (!phones.size && !input.customerId) return [];
    return (orders || []).filter(order => order && !order.deletedAt && order.id !== options.excludeOrderId && isRefusedOrder(order) && (
      [order.phone, order.alternativePhone].map(normalizePhone).some(phone => phone && phones.has(phone)) || (input.customerId && order.customerId === input.customerId)
    )).sort((a, b) => new Date(b.refusedAt || b.returnedAt || b.updatedAt || 0) - new Date(a.refusedAt || a.returnedAt || a.updatedAt || 0));
  }

  return { RECENT_SHIPPED_DAYS, MIN_REASON_LENGTH, normalizePhone, normalizeName, orderState, stageLabel, findCustomerOrders, blockingMatches, validReason, isRefusedOrder, findRefusalHistory };
});
