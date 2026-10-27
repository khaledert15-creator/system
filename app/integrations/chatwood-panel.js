"use strict";
// Chatwood dashboard-app panel (shown beside the conversation). Chatwood tells us the open conversation through
// postMessage; identity and permissions come only from a System login inside the panel (Chatwood data alone is never
// trusted). Orders are created, edited and cancelled here through the System's own order endpoints, so the same
// rules apply as on the System screens; suggestions read from the messages are applied only when the employee taps them.
(function () {
  const CHATWOOD_ORIGIN = document.querySelector('meta[name="chatwood-origin"]')?.content || "";
  const TOKEN_KEY = "maktabaa-chatwood-panel-session";
  const state = { token: sessionStorage.getItem(TOKEN_KEY) || "", user: null, phone: "", rawPhone: "", conversationId: "", contactId: "", contactName: "", data: null, loading: false, messages: [], catalog: null, form: null };
  const $ = id => document.getElementById(id);

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : String(value));
    }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    return node;
  }

  const money = value => `${Number(value || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م`;
  const dateLabel = value => { const date = new Date(value || ""); return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" }); };
  function message(text, tone = "") { const node = $("panel-message"); node.textContent = text || ""; node.className = `message ${tone}`; }

  function normalizePhone(value) {
    let digits = String(value || "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/\D/g, "");
    if (digits.startsWith("0020")) digits = digits.slice(2);
    if (digits.startsWith("20") && digits.length === 12) digits = `0${digits.slice(2)}`;
    if (/^1\d{9}$/.test(digits)) digits = `0${digits}`;
    return /^01\d{9}$/.test(digits) ? digits : "";
  }

  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, cache: "no-store", headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(state.token ? { "X-Session-Token": state.token } : {}) } });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 && path !== "/api/login") { logout(false); throw Object.assign(new Error("انتهت الجلسة، سجّل الدخول مرة أخرى."), { status: 401 }); }
    if (!response.ok) throw Object.assign(new Error(body.message || "تعذر تنفيذ الطلب."), { status: response.status, code: body.code, orders: body.orders });
    return body;
  }

  function showLogin(text = "") {
    $("login-view").hidden = false; $("context-view").hidden = true; $("logout-button").hidden = true; $("panel-user").textContent = "";
    $("login-message").textContent = text;
  }

  function showContext() {
    $("login-view").hidden = true; $("context-view").hidden = false; $("logout-button").hidden = false;
    $("panel-user").textContent = state.user ? `${state.user.name || state.user.username}` : "";
    $("conversation-label").textContent = state.conversationId ? `#${state.conversationId}` : "—";
    $("phone-label").textContent = state.rawPhone || state.phone || "—";
    $("manual-form").hidden = Boolean(state.phone);
    // A contact without a usable phone (WhatsApp username, foreign number) is still looked up by its conversation.
    if (state.phone || state.conversationId) load(); else { $("customer-card").replaceChildren(); $("orders-list").replaceChildren(); }
  }

  function logout(callServer = true) {
    if (callServer && state.token) fetch("/api/logout", { method: "POST", headers: { "X-Session-Token": state.token } }).catch(() => {});
    state.token = ""; state.user = null; sessionStorage.removeItem(TOKEN_KEY); showLogin();
  }

  async function restoreSession() {
    if (!state.token) return showLogin();
    try { state.user = (await api("/api/session")).user; showContext(); }
    catch { showLogin(); }
  }

  $("login-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      const result = await api("/api/login", { method: "POST", body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
      state.token = result.token; state.user = result.user; sessionStorage.setItem(TOKEN_KEY, result.token);
      event.target.reset(); showContext();
    } catch (error) { $("login-message").textContent = error.status === 429 ? error.message : "اسم المستخدم أو كلمة المرور غير صحيحة."; }
  });
  $("logout-button").addEventListener("click", () => logout(true));
  $("manual-form").addEventListener("submit", event => {
    event.preventDefault();
    const phone = normalizePhone(new FormData(event.target).get("phone"));
    if (!phone) return message("اكتب رقم موبايل مصري صحيح.", "error");
    state.phone = phone; state.rawPhone = phone; showContext();
  });

  // Chatwood dashboard app context: {event:"appContext", data:{conversation, contact, currentAgent}} (JSON string).
  window.addEventListener("message", event => {
    if (!CHATWOOD_ORIGIN || event.origin !== CHATWOOD_ORIGIN) return;
    let payload = event.data;
    if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch { return; } }
    if (!payload || payload.event !== "appContext" || typeof payload.data !== "object") return;
    const contact = payload.data.contact || {}, conversation = payload.data.conversation || {};
    const conversationId = String(conversation.id ?? "").trim();
    const rawPhone = String(contact.phone_number || conversation.meta?.sender?.phone_number || "").trim();
    const contactId = String(contact.id ?? conversation.meta?.sender?.id ?? "").trim();
    const changed = conversationId !== state.conversationId || rawPhone !== state.rawPhone || contactId !== state.contactId;
    state.conversationId = /^\d{1,18}$/.test(conversationId) ? conversationId : "";
    state.contactId = /^\d{1,18}$/.test(contactId) ? contactId : "";
    state.rawPhone = rawPhone; state.phone = normalizePhone(rawPhone); state.contactName = String(contact.name || "");
    state.messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    if (state.form && !changed) refreshSuggestions();
    if (!state.phone) $("manual-hint").textContent = rawPhone ? "رقم جهة الاتصال ليس رقم موبايل مصري. اكتب رقم العميل يدويًا." : "جهة الاتصال بدون رقم هاتف. اكتب رقم العميل يدويًا.";
    if (changed && state.user) { state.form = null; showContext(); }
  });
  // Chatwood sends the conversation (with the messages on screen) only when asked; ask again while the form is open so
  // new customer messages turn into suggestions.
  setInterval(() => {
    if (state.form && !state.form.done && document.visibilityState === "visible" && window.parent !== window && CHATWOOD_ORIGIN) window.parent.postMessage("chatwoot-dashboard-app:fetch-info", CHATWOOD_ORIGIN);
  }, 8000);
  if (window.parent !== window && CHATWOOD_ORIGIN) window.parent.postMessage("chatwoot-dashboard-app:fetch-info", CHATWOOD_ORIGIN);

  function failure(text, retry = true) {
    $("customer-card").replaceChildren();
    $("orders-list").replaceChildren(el("div", { class: "card state error" }, el("strong", { text }), retry ? el("button", { type: "button", class: "btn ghost", onclick: load, text: "إعادة المحاولة" }) : ""));
  }

  async function load() {
    if ((!state.phone && !state.conversationId) || state.loading) return;
    state.loading = true; message("جارٍ التحميل…");
    try {
      const query = new URLSearchParams();
      if (state.phone) query.set("phone", state.phone);
      if (state.conversationId) query.set("conversationId", state.conversationId);
      if (state.contactId) query.set("contactId", state.contactId);
      state.data = await api(`/api/integration/v1/panel/customer?${query}`);
      message(state.data.storeEnabled && !state.data.storeAvailable ? "تعذر الوصول إلى المتجر الآن؛ تظهر طلبات السيستم فقط، وطلبات الموقع غير المعتمدة قد تكون ناقصة." : "", state.data.storeEnabled && !state.data.storeAvailable ? "warning" : "");
      render();
    } catch (error) {
      if (error.status === 401) return;
      message("");
      // Never «no orders» when the real reason is a failure or a missing permission.
      if (error.status === 403) failure("ليس لديك صلاحية عرض بيانات العملاء.", false);
      else if (error.status === 503) failure("التكامل غير مفعّل في السيستم.", false);
      else if (error.code === "CUSTOMER_NOT_IDENTIFIED" || error.code === "INVALID_PHONE") failure("تعذر التعرف على العميل من بيانات المحادثة. اكتب رقمه يدويًا.", false);
      else failure(`تعذر تحميل طلبات العميل: ${error.message}`);
    } finally { state.loading = false; }
  }

  const CURRENT = ["awaiting_confirmation", "awaiting_deposit", "preparing", "shipped", "preorder"];
  const HISTORY = ["delivered", "cancelled", "returned", "not_completed", "previous"];
  const PHASE_TITLES = { awaiting_confirmation: "بانتظار التأكيد", awaiting_deposit: "بانتظار العربون", preparing: "قيد التجهيز", shipped: "تم الشحن", preorder: "حجوزات مسبقة جارية", delivered: "تم التسليم", cancelled: "ملغية", returned: "مرتجعات", not_completed: "لم تكتمل (مؤرشفة)", previous: "طلبات سابقة" };

  function render() {
    // While the order form is open it gets the room: the conversation card and the manual phone box are hidden.
    document.querySelector(".context-card").hidden = Boolean(state.form);
    if (state.form) { $("manual-form").hidden = true; return renderForm(); }
    const { customer, orders } = state.data;
    const name = customer.name || state.contactName || "عميل غير مسجل";
    $("customer-card").replaceChildren(el("div", { class: "card customer" },
      el("div", { class: "row" }, el("strong", { text: name }), el("span", { class: `badge ${customer.status === "new" ? "new" : "returning"}`, text: customer.status === "new" ? "عميل جديد" : "عميل سابق" })),
      el("div", { class: "muted", dir: "ltr", text: customer.phone || (state.data.phoneUsable ? "" : "بدون رقم موبايل مصري") }),
      el("div", { class: "stats" },
        el("div", {}, el("span", { text: "عدد الطلبات" }), el("b", { text: String(customer.ordersCount ?? orders.length) })),
        el("div", {}, el("span", { text: "مشتريات فعلية" }), el("b", { text: `${money(customer.purchasesTotal)} (${customer.purchasesCount})` })),
        el("div", {}, el("span", { text: "متبقي على فواتيره" }), el("b", { class: customer.outstanding > 0 ? "due" : "", text: money(customer.outstanding) })))));
    if (!customer.identified) {
      $("orders-list").replaceChildren(newOrderLink(), suggestionSection(), el("div", { class: "card state" }, el("strong", { text: state.phone ? "الرقم ده مش مسجل في السيستم ولا في الموقع." : "مفيش طلبات مربوطة بالمحادثة دي، وجهة الاتصال مفيهاش رقم موبايل مصري." }), el("span", { class: "muted", text: "لو العميل طلب برقم تاني، اكتبه يدويًا." })), recipientSection());
      $("manual-form").hidden = Boolean(state.phone);
      return;
    }
    if (!orders.length) { $("orders-list").replaceChildren(newOrderLink(), suggestionSection(), el("div", { class: "card state" }, el("strong", { text: "العميل مسجل ومفيش له طلبات." })), recipientSection()); return; }
    const section = (title, phases) => {
      const groups = phases.map(phase => [phase, orders.filter(order => order.phase === phase)]).filter(([, list]) => list.length);
      if (!groups.length) return el("section", { class: "orders-section" }, el("h2", { text: `${title} (0)` }), el("p", { class: "muted small", text: "لا يوجد." }));
      return el("section", { class: "orders-section" }, el("h2", { text: `${title} (${groups.reduce((sum, [, list]) => sum + list.length, 0)})` }),
        groups.map(([phase, list]) => el("div", { class: "phase" }, el("h3", { text: `${PHASE_TITLES[phase]} (${list.length})` }), list.map(orderCard))));
    };
    $("orders-list").replaceChildren(newOrderLink(), suggestionSection(), section("الطلبات الحالية", CURRENT), section("سجل الطلبات", HISTORY), recipientSection(),
      state.data.truncated ? el("p", { class: "muted small", text: `يظهر أحدث ${orders.length} من ${state.data.totalOrders} طلب.` }) : "");
  }

  // Opens the System's quick order tied to this conversation. The link carries only a short-lived token the System
  // issued after the Store verified the conversation (no raw ids), so the order is linked automatically.
  function newOrderLink() {
    const context = state.data?.orderContext;
    if (!state.conversationId || !context) return "";
    if (!context.ok) return el("div", { class: "card state small" }, el("strong", { text: "مش هينفع تعمل طلب مربوط بالمحادثة دي دلوقتي" }), el("div", { class: "muted", text: context.message || "تعذر التحقق من المحادثة." }));
    return el("button", { type: "button", class: "btn new-order", onclick: () => openCreateForm(), text: "＋ طلب جديد للمحادثة دي" });
  }

  // Orders a staff member named (ORD-…) in this conversation. A suggestion is linked only when an employee confirms it
  // here; an order that belongs to another customer is shown as a conflict and cannot be linked from the tab.
  function suggestionSection() {
    const suggestions = state.data?.suggestions || [], conflicts = state.data?.mentionConflicts || [];
    if (!suggestions.length && !conflicts.length) return "";
    return el("section", { class: "orders-section suggestions" }, el("h2", { text: "اقتراحات ربط من رسايل الموظفين" }),
      suggestions.map(row => el("article", { class: "card order" },
        el("div", { class: "row" }, el("span", { class: "badge sys", text: row.orderId }), el("span", { class: "status current", text: row.status || "—" })),
        el("div", { class: "muted small", text: `رقم الطلب اتكتب في رسالة موظف هنا${row.mentionedAt ? ` · ${dateLabel(row.mentionedAt)}` : ""}` }),
        el("div", { class: "muted small", text: `المستلم ${row.recipientMasked || "—"} · ${row.recipientIsContactPhone ? "نفس رقم جهة الاتصال" : "رقم مختلف عن جهة الاتصال"} · الإجمالي ${money(row.total)}` }),
        el("div", { class: "actions" }, state.data.canLink ? el("button", { type: "button", class: "btn", onclick: () => confirmSuggestion(row), text: "تأكيد ربط الطلب بالمحادثة دي" }) : el("span", { class: "muted small", text: "التأكيد محتاج صلاحية الربط." })))),
      conflicts.map(row => el("article", { class: "card order" },
        el("div", { class: "row" }, el("span", { class: "badge sys", text: row.orderId }), el("span", { class: "status history", text: "مربوط بعميل تاني" })),
        el("div", { class: "small muted", text: `الطلب اتذكر هنا، لكنه مربوط بمحادثة تانية${row.linkedConversationId ? ` #${row.linkedConversationId}` : ""}. لو الربط ده غلط، التصحيح للمالك أو المدير من السيستم.` }))));
  }

  async function confirmSuggestion(row) {
    if (!confirm(`تأكيد إن الطلب ${row.orderId} تبع صاحب المحادثة #${state.conversationId}؟ اتأكد من الكتب والعنوان الأول.`)) return;
    try {
      await api(`/api/orders/${encodeURIComponent(row.orderId)}/chatwood-link`, { method: "POST", body: JSON.stringify({ conversationId: state.conversationId, contactId: state.data.verifiedContactId || state.contactId, source: "suggestion" }) });
      message(`اتربط الطلب ${row.orderId} بالمحادثة.`, "ok");
      load();
    } catch (error) {
      if (error.status === 401) return;
      message({ ORDER_ALREADY_LINKED: "الطلب مربوط بمحادثة تانية بالفعل.", SUGGESTION_NOT_FOUND: "الاقتراح ده مبقاش موجود.", CONTACT_MISMATCH: "جهة الاتصال اتغيرت؛ حدّث التبويب." }[error.code] || (error.status === 403 ? "ليس لديك صلاحية الربط." : `تعذر الربط: ${error.message}`), "error");
    }
  }

  // Orders where this number is only the delivery phone of another customer's order: status and tracking only.
  function recipientSection() {
    const list = state.data.recipientOrders || [];
    if (!list.length) return "";
    return el("section", { class: "orders-section recipient" }, el("h2", { text: `طلبات الرقم ده فيها مستلم بس (${list.length})` }),
      el("p", { class: "muted small", text: "صاحب الطلب عميل تاني. بيظهر رقم الطلب وحالة الشحن بس." }),
      list.map(order => el("article", { class: "card order recipient" },
        el("div", { class: "row" }, el("span", { class: "badge sys", text: order.salesOrderId }), el("span", { class: "status", text: order.phaseLabel })),
        el("div", { class: "muted small" }, order.createdAt ? dateLabel(order.createdAt) : "", order.shipment ? ` · ${order.shipment.statusLabel || order.shipment.status}` : " · لم يُشحن", order.trackingNumber ? el("span", { dir: "ltr", class: "tracking", text: ` ${order.trackingNumber}` }) : ""),
        el("div", { class: "actions" }, el("a", { class: "btn ghost", href: order.links.system, target: "_blank", rel: "noopener noreferrer", text: "فتح في السيستم" })))));
  }

  function orderCard(order) {
    const numbers = [
      el("span", { class: `badge src ${order.source}`, text: order.sourceLabel || order.source }),
      order.websiteOrderNumber && el("span", { class: "badge web", text: `🌐 ${order.websiteOrderNumber}` }),
      order.salesOrderId && el("span", { class: "badge sys", text: order.salesOrderId }),
      order.invoiceId && el("span", { class: "badge inv", text: order.invoiceId }),
      order.splitPart && el("span", { class: "badge", text: `شحنة ${order.splitPart}` })];
    const shipment = order.shipment ? `${order.shipment.statusLabel || order.shipment.status}${order.shipment.carrier ? ` · ${order.shipment.carrier}` : ""}` : "لم يُشحن";
    const canLink = order.websiteOrderNumber && state.conversationId && !order.linkedToConversation && !order.chatwootConversationId;
    return el("article", { class: `card order ${order.linkedToConversation ? "linked" : ""}` },
      el("div", { class: "row" }, el("div", { class: "numbers" }, numbers), el("span", { class: `status ${order.group}`, text: order.awaitingApproval ? "بانتظار الاعتماد في السيستم" : order.phaseLabel || order.status || "—" })),
      el("div", { class: "muted small" }, order.createdAt ? dateLabel(order.createdAt) : "بدون تاريخ", order.kind !== "website_order" && order.status && order.phaseLabel && order.status !== order.phaseLabel ? ` · ${order.status}` : "", order.matchedBy === "conversation" ? " · مربوط بالمحادثة" : order.matchedBy === "contact" ? " · مربوط بجهة الاتصال" : ""),
      el("ul", { class: "products" }, (order.products || []).slice(0, 8).map(item => el("li", {}, `${item.name} × ${item.qty}`))),
      // Total, deposit (everything paid so far) and what is left; the required deposit shows only while it is not reached.
      el("div", { class: "stats" },
        el("div", {}, el("span", { text: "الإجمالي" }), el("b", { text: money(order.total) })),
        el("div", {}, el("span", { text: "العربون" }), el("b", { text: money(order.paid) }),
          order.depositRequired != null && Number(order.paid) < Number(order.depositRequired) && order.group !== "history" ? el("small", { class: "warn", text: `المطلوب ${money(order.depositRequired)}` }) : ""),
        el("div", {}, el("span", { text: "الباقي" }), el("b", { class: order.remaining > 0 ? "due" : "", text: money(order.remaining) }))),
      el("div", { class: "muted small" }, `الشحن: ${shipment}`, order.trackingNumber ? el("span", { dir: "ltr", class: "tracking", text: ` ${order.trackingNumber}` }) : ""),
      order.linkedToConversation ? el("div", { class: "small ok", text: "✓ مربوط بهذه المحادثة" }) : order.chatwootConversationId ? el("div", { class: "small muted", text: `مربوط بمحادثة أخرى #${order.chatwootConversationId}` }) : "",
      el("div", { class: "actions" },
        order.links?.system && el("a", { class: "btn ghost", href: order.links.system, target: "_blank", rel: "noopener noreferrer", text: "فتح في السيستم" }),
        order.links?.store && el("a", { class: "btn ghost", href: order.links.store, target: "_blank", rel: "noopener noreferrer", text: "فتح في لوحة المتجر" }),
        canLink && el("button", { type: "button", class: "btn", onclick: () => linkConversation(order), text: "ربط بهذه المحادثة" }),
        order.salesOrderId && order.group !== "history" && el("button", { type: "button", class: "btn ghost", onclick: () => openEditForm(order.salesOrderId), text: "تعديل" }),
        order.salesOrderId && order.group !== "history" && order.remaining > 0 && el("button", { type: "button", class: "btn ghost", onclick: event => startPayment(order, event.target.closest(".actions")), text: "＋ دفعة" }),
        order.salesOrderId && order.group !== "history" && el("button", { type: "button", class: "btn ghost danger", onclick: event => startCancel(order.salesOrderId, event.target.closest(".actions")), text: "إلغاء" })));
  }

  async function linkConversation(order) {
    if (!confirm(`ربط الطلب ${order.websiteOrderNumber} بالمحادثة #${state.conversationId}؟`)) return;
    try {
      await api("/api/integration/v1/panel/link-conversation", { method: "POST", body: JSON.stringify({ orderNumber: order.websiteOrderNumber, conversationId: state.conversationId, contactPhone: state.phone }) });
      message("تم ربط الطلب بالمحادثة.", "ok");
      load();
    } catch (error) {
      if (error.status === 401) return;
      message({ PHONE_MISMATCH: "رقم المحادثة لا يطابق رقم صاحب الطلب.", CONVERSATION_ALREADY_LINKED: "الطلب مربوط بمحادثة أخرى بالفعل." }[error.code] || (error.status === 403 ? "ليس لديك صلاحية الربط." : error.message), "error");
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Order form inside the panel: create (linked to this conversation by the verified context token), edit and cancel.
  const PLAN_LABELS = { cash_on_delivery: "الدفع عند الاستلام", advance_cod: "مقدم + الباقي عند الاستلام", prepaid_full: "مدفوع بالكامل مسبقًا" };
  const CANCEL_REASONS = ["العميل ألغى الطلب", "العميل لا يرد", "طلب مكرر", "نفاد المخزون", "خطأ في بيانات الطلب", "أخرى"];
  const amount = value => Number(Number(value || 0).toFixed(2)).toString();

  async function loadCatalog() {
    if (state.catalog) return state.catalog;
    const catalog = await api("/api/integration/v1/panel/order-form");
    catalog.byId = new Map(catalog.books.map(book => [book.id, book]));
    catalog.index = ChatwoodSuggest.bookIndex(catalog.books);
    return (state.catalog = catalog);
  }

  function emptyDraft() {
    const customer = state.data?.customer || {}, saved = customer.address || {};
    // A WhatsApp name of dots or digits is not a name.
    const contactName = /\d{5,}/.test(state.contactName) || !/\p{L}{2,}/u.test(state.contactName) ? "" : state.contactName;
    return { phone: state.phone, customerName: customer.known ? customer.name : (customer.name || contactName), alternativePhone: saved.alternativePhone || "", governorate: saved.governorate || "", city: EgyptCities.canonicalCity(saved.governorate, saved.city) || saved.city || "",
      address: saved.address || "", addressMark: saved.addressMark || "", shippingCompany: state.catalog.defaultShippingCompany, shippingCost: 0, shippingManual: false, lines: [], paymentPlan: "cash_on_delivery",
      paidAmount: 0, paymentConfirmed: false, cashAccountId: "", receiptMethod: "InstaPay", notes: "", orderDiscount: 0, orderDiscountType: "percent", requestId: `panel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      customerEdit: { confirmed: false, channel: "واتساب", note: "" }, reopenConfirmed: false, duplicateOverrideReason: "" };
  }

  async function openCreateForm() {
    try { await loadCatalog(); } catch (error) { if (error.status !== 401) message(error.status === 403 ? "ليس لديك صلاحية إنشاء الطلبات." : `تعذر فتح الفورم: ${error.message}`, "error"); return; }
    state.form = { mode: "create", draft: emptyDraft(), search: "", applied: new Set(), error: "" };
    message(""); render();
  }

  async function openEditForm(orderId) {
    let result;
    try { await loadCatalog(); result = await api(`/api/integration/v1/panel/order?id=${encodeURIComponent(orderId)}`); }
    catch (error) { if (error.status !== 401) message(error.status === 403 ? "ليس لديك صلاحية تعديل الطلبات." : `تعذر فتح الطلب: ${error.message}`, "error"); return; }
    if (result.editBlock) return message(`${orderId}: ${result.editBlock}`, "warning");
    const order = result.order;
    state.form = { mode: "edit", order, search: "", applied: new Set(), error: "", draft: { ...emptyDraft(), phone: order.phone, customerName: order.customerName, alternativePhone: order.alternativePhone, governorate: order.governorate, city: EgyptCities.canonicalCity(order.governorate, order.city) || order.city || "",
      address: order.address, addressMark: order.addressMark, shippingCompany: order.shippingCompany || state.catalog.defaultShippingCompany, shippingCost: order.shippingCost, notes: order.notes, orderDiscount: order.orderDiscount, orderDiscountType: order.orderDiscountType,
      paymentPlan: order.paymentPlan, paidAmount: order.paidAmount, lines: order.lines.map(line => ({ ...line })) } };
    state.form.draft.shippingManual = Math.abs(order.shippingCost - autoShipping(state.form.draft)) > 0.009;
    message(""); render();
  }

  function goods(lines, draft) { return OrderFinance.calculateOrder(lines.map(line => ({ ...line, discountScope: "unit" })), { shippingCost: 0, orderDiscount: draft.orderDiscount, orderDiscountType: draft.orderDiscountType }).goods; }
  function autoShipping(draft) { return OrderFinance.resolveShippingRate(state.catalog.shippingRules, draft.governorate, goods(draft.lines, draft)).fee; }
  function totals(draft) {
    if (!draft.shippingManual) draft.shippingCost = autoShipping(draft);
    return OrderFinance.calculateOrder(draft.lines.map(line => ({ ...line, discountScope: "unit" })), { shippingCost: draft.shippingCost, orderDiscount: draft.orderDiscount, orderDiscountType: draft.orderDiscountType });
  }
  function availableFor(line) { const book = state.catalog.byId.get(line.bookId); return Math.max(0, Number(book?.available || 0)) + Number(line.reserved || 0); }

  function addBook(book, qty = 1) {
    const draft = state.form.draft, existing = draft.lines.find(line => line.bookId === book.id);
    if (existing) existing.qty += qty;
    else draft.lines.push({ bookId: book.id, qty, price: Number(book.price || 0), discount: book.discount, discountType: book.discountType, reserved: 0, fromStore: state.form.order?.website });
    state.form.search = "";
    state.form.bookActive = 0;
    const input = $("form-book-search"); if (input) { input.value = ""; input.focus(); }
    refreshLines(); refreshResults();
  }

  function field(label, name, attrs = {}) {
    const draft = state.form.draft;
    const input = el(attrs.multiline ? "textarea" : "input", { name, value: attrs.multiline ? undefined : draft[name] || "", dir: attrs.dir, inputmode: attrs.inputmode, placeholder: attrs.placeholder, list: attrs.list, rows: attrs.multiline ? 2 : undefined,
      oninput: event => { draft[name] = event.target.value; if (name === "governorate") refreshTotals(); clearError(); } });
    if (attrs.multiline) input.value = draft[name] || "";
    return el("label", { class: `field ${attrs.wide ? "wide" : ""} ${attrs.required ? "required" : ""}`, "data-field": name }, el("span", { text: label }), input);
  }

  // A text box with a list under it: typing filters the list (tolerant of ه/ة، أ/ا، «ال» and one typo), ↑/↓ move,
  // Enter or a click picks, Esc closes. Leaving the box without picking puts back the value that was picked before.
  function combo({ field, label, value, placeholder, disabled, hint, items, pick }) {
    let active = 0, shown = [];
    const input = el("input", { name: field, value: value || "", placeholder, disabled, autocomplete: "off", role: "combobox", "aria-expanded": "false" });
    const list = el("div", { class: "combo-list", role: "listbox", hidden: true });
    const open = () => {
      const typed = input.value.trim() === String(value || "") ? "" : input.value;
      shown = items(typed); active = 0;
      list.replaceChildren(...(shown.length ? shown.map((item, index) => el("button", { type: "button", role: "option", class: `combo-option ${index === active ? "active" : ""}`,
        onmousedown: event => { event.preventDefault(); choose(item); } }, el("span", { text: item.label }), item.hint ? el("small", { text: item.hint }) : "")) : [el("div", { class: "combo-empty", text: "مفيش نتيجة. جرّب تكتب بطريقة تانية." })]));
      list.hidden = false; input.setAttribute("aria-expanded", "true");
    };
    const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); };
    const move = step => {
      if (list.hidden) return open();
      if (!shown.length) return;
      active = (active + step + shown.length) % shown.length;
      list.querySelectorAll(".combo-option").forEach((node, index) => node.classList.toggle("active", index === active));
      list.querySelectorAll(".combo-option")[active]?.scrollIntoView({ block: "nearest" });
    };
    const choose = item => { close(); pick(item); };
    input.addEventListener("focus", () => { input.select(); open(); });
    input.addEventListener("input", () => { clearError(); open(); });
    input.addEventListener("keydown", event => {
      if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
      else if (event.key === "Enter") { event.preventDefault(); if (!list.hidden && shown[active]) choose(shown[active]); }
      else if (event.key === "Escape") { close(); input.value = value || ""; }
    });
    input.addEventListener("blur", () => { close(); if (input.value !== (value || "")) input.value = value || ""; });
    return el("label", { id: `${field}-field`, class: "field required combo", "data-field": field }, el("span", { text: label }), el("div", { class: "combo-box" }, input, list), hint ? el("small", { class: "muted", text: hint }) : "");
  }

  // Governorate and city: the city list holds only the chosen governorate's cities and centres. Typing a city in the
  // governorate box (or in the city box before a governorate) picks both. A city saved earlier in another spelling
  // stays shown until one is picked from the list.
  function setPlace(governorate, city) {
    const draft = state.form.draft, changed = governorate !== draft.governorate;
    draft.governorate = governorate;
    draft.city = city || EgyptCities.canonicalCity(governorate, draft.city);
    $("governorate-field")?.replaceWith(governorateField());
    $("city-field")?.replaceWith(cityField());
    if (changed) refreshTotals();
    clearError();
    if (!draft.city) setTimeout(() => document.querySelector('#city-field input')?.focus(), 0);
  }

  function governorateField() {
    const draft = state.form.draft;
    return combo({ field: "governorate", label: "المحافظة", value: draft.governorate, placeholder: "اكتب المحافظة أو المدينة…",
      items: typed => typed.trim()
        ? EgyptCities.searchGovernorates(typed, 12).map(item => ({ ...item, label: item.city ? `${item.city}` : item.governorate, hint: item.city ? `محافظة ${item.governorate}` : "" }))
        : EgyptCities.GOVERNORATES.map(governorate => ({ governorate, city: "", label: governorate })),
      pick: item => setPlace(item.governorate, item.city) });
  }

  function cityField() {
    const draft = state.form.draft, cities = EgyptCities.citiesOf(draft.governorate), listed = cities.includes(draft.city);
    return combo({ field: "city", label: "المدينة / المركز", value: draft.city, placeholder: draft.governorate ? `اكتب مدينة أو مركز في ${draft.governorate}…` : "اكتب المدينة، والمحافظة هتتحدد لوحدها…",
      hint: draft.city && !listed ? "المدينة دي مكتوبة بطريقة قديمة؛ اختار واحدة من القايمة." : "القرية أو الشارع يتكتبوا في العنوان.",
      items: typed => EgyptCities.searchCities(typed, draft.governorate, draft.governorate ? 60 : 12).map(item => ({ ...item, label: item.city, hint: draft.governorate ? "" : `محافظة ${item.governorate}` })),
      pick: item => setPlace(item.governorate, item.city) });
  }

  function renderForm() {
    const form = state.form, draft = form.draft, catalog = state.catalog;
    if (form.done) return renderDone();
    const order = form.order;
    const title = form.mode === "create" ? `طلب جديد · محادثة #${state.conversationId}` : `تعديل ${order.id}${order.websiteOrderNumber ? ` · 🌐 ${order.websiteOrderNumber}` : ""}`;
    const notices = [];
    if (order?.website) notices.push(el("div", { class: "notice warn" }, el("strong", { text: "طلب موقع: بيتعدّل بطلب العميل بس" }),
      el("span", { class: "small", text: "الكتب اللي في الطلب بسعر الموقع، والكتاب الجديد بياخد سعره على الموقع وقت الحفظ." }),
      el("label", { class: "check" }, el("input", { type: "checkbox", checked: draft.customerEdit.confirmed, onchange: event => { draft.customerEdit.confirmed = event.target.checked; clearError(); } }), "العميل هو اللي طلب التعديل ده"),
      el("div", { class: "two" }, el("select", { onchange: event => { draft.customerEdit.channel = event.target.value; } }, ["واتساب", "مكالمة", "رسالة على الموقع"].map(item => el("option", { selected: item === draft.customerEdit.channel, text: item }))),
        el("input", { placeholder: "إيه اللي طلبه (اختياري)", value: draft.customerEdit.note, oninput: event => { draft.customerEdit.note = event.target.value; } }))));
    if (order?.packed) notices.push(el("div", { class: "notice warn" }, el("strong", { text: `الطلب متغلّف${order.saleId ? ` وليه فاتورة ${order.saleId}` : ""}` }),
      el("span", { class: "small", text: "عند الحفظ هيرجع «جاهز للتغليف»، وفاتورته هتتلغي، والكتب تفضل محجوزة له. غلّفه تاني بعد التعديل." }),
      el("label", { class: "check" }, el("input", { type: "checkbox", checked: draft.reopenConfirmed, onchange: event => { draft.reopenConfirmed = event.target.checked; clearError(); } }), "تمام، رجّعه للتغليف")));
    else if (order && ["preparing", "needs_review"].includes(order.workflowStage)) notices.push(el("div", { class: "notice" }, el("span", { class: "small", text: "التجهيز بدأ: قائمة التجهيز هتتصفّر وموظف التجهيز هيوصله تنبيه." })));
    const receive = catalog.permissions.receive && form.mode === "create";
    const payment = el("section", { class: "block" }, el("h3", { text: "4 · الدفع" }),
      form.mode === "edit" ? el("div", { class: "small muted", text: `المدفوع: ${money(draft.paidAmount)} · تصحيح الدفعات من تفاصيل الطلب في السيستم.` })
        : el("div", {},
          el("select", { name: "paymentPlan", onchange: event => { draft.paymentPlan = event.target.value; refreshPayment(); refreshTotals(); } },
            Object.entries(PLAN_LABELS).filter(([key]) => receive || key === "cash_on_delivery").map(([key, label]) => el("option", { value: key, selected: draft.paymentPlan === key, text: label }))),
          el("div", { id: "payment-fields" }),
          el("div", { class: "small muted", text: `العربون المطلوب لطلبات الواتساب: ${money(catalog.depositRequired)}` })));
    $("orders-list").replaceChildren(el("section", { class: "card order-form" },
      el("div", { class: "row" }, el("h2", { text: title }), el("button", { type: "button", class: "link", onclick: closeForm, text: "رجوع" })),
      notices,
      el("div", { id: "suggestions", class: "chips" }),
      el("section", { class: "block" }, el("h3", { text: "1 · العميل والعنوان" }),
        el("div", { class: "grid" }, field("رقم المستلم", "phone", { dir: "ltr", inputmode: "tel", placeholder: "01xxxxxxxxx", required: true }), field("الاسم", "customerName", { required: true }),
          governorateField(), cityField(), field("العنوان (القرية / الشارع / العمارة)", "address", { wide: true, multiline: true, required: true }),
          field("علامة مميزة", "addressMark"), field("رقم بديل", "alternativePhone", { dir: "ltr", inputmode: "tel" }))),
      el("section", { class: "block", "data-field": "lines" }, el("h3", { text: "2 · الكتب" }),
        el("input", { id: "form-book-search", class: "search", placeholder: "ابحث عن كتاب: الاسم، المادة، الصف (↑↓ ثم Enter)", autocomplete: "off",
          oninput: event => { form.search = event.target.value; form.bookActive = 0; refreshResults(); },
          onkeydown: event => {
            const count = $("book-results")?.querySelectorAll(".result").length || 0;
            if ((event.key === "ArrowDown" || event.key === "ArrowUp") && count) { event.preventDefault(); form.bookActive = ((form.bookActive || 0) + (event.key === "ArrowDown" ? 1 : -1) + count) % count; refreshResults(); }
            else if (event.key === "Enter") { event.preventDefault(); const book = (form.bookResults || [])[form.bookActive || 0]; if (book) addBook(book); }
            else if (event.key === "Escape") { form.search = ""; event.target.value = ""; refreshResults(); } } }),
        el("div", { id: "book-results", class: "results" }), el("div", { id: "form-lines" }), orderDiscountField()),
      el("section", { class: "block" }, el("h3", { text: "3 · الشحن" }),
        el("div", { class: "grid" },
          el("label", { class: "field" }, el("span", { text: "شركة الشحن" }), el("select", { onchange: event => { draft.shippingCompany = event.target.value; } }, catalog.shippingCompanies.map(name => el("option", { selected: name === draft.shippingCompany, text: name })))),
          el("label", { class: "field" }, el("span", { text: "رسوم الشحن" }), catalog.permissions.shipping
            ? el("input", { id: "shipping-input", inputmode: "decimal", value: amount(draft.shippingCost), oninput: event => { const value = Number(String(event.target.value).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))); if (Number.isFinite(value) && value >= 0) { draft.shippingCost = value; draft.shippingManual = true; refreshTotals(false); } } })
            : el("b", { id: "shipping-label" })))),
      payment,
      el("section", { class: "block" }, field("ملاحظة", "notes", { wide: true, multiline: true })),
      el("div", { id: "form-totals", class: "totals" }),
      el("div", { class: "form-footer" },
        el("div", { id: "duplicate-box" }),
        el("p", { id: "form-error", class: "message error", role: "alert" }),
        el("div", { class: "footer-row" },
          el("div", { class: "footer-total" }, el("span", { class: "small muted", text: "الإجمالي" }), el("b", { id: "footer-total", text: "—" })),
          el("button", { type: "button", id: "form-save", class: "btn", onclick: saveForm, text: form.mode === "create" ? (catalog.permissions.confirm ? "حفظ وتأكيد الطلب" : "حفظ الطلب") : "حفظ التعديل" })))));
    refreshSuggestions(); refreshResults(); refreshLines(); refreshPayment(); refreshTotals(); refreshDuplicate();
  }

  // The System refuses a new order while the customer has an open one: the employee adds to it or writes why it is separate.
  function refreshDuplicate() {
    const box = $("duplicate-box"), form = state.form, orders = form?.duplicateOrders || [];
    if (!box) return;
    if (!orders.length) return box.replaceChildren();
    const hint = match => match.state === "packed" ? "مغلّف ومنتظر كود التتبع: قبل أي إضافة ارجع لموظف التغليف." : match.strength === "weak" ? "نفس الاسم في نفس المحافظة برقم تاني: اسأل العميل لو هو نفس الشخص." : "الأفضل تضيف الكتب على الطلب ده.";
    box.replaceChildren(el("div", { class: "notice warn duplicate" },
      el("strong", { text: "⚠ العميل ده عنده طلب مفتوح؛ اتأكد منه قبل ما تسجل طلب جديد" }),
      orders.map(match => el("div", { class: "row" },
        el("span", { class: "small", text: `${match.id} · ${match.label} — ${hint(match)}` }),
        match.state === "open" ? el("button", { type: "button", class: "link", onclick: () => openEditForm(match.id), text: "أضف عليه" }) : "")),
      el("input", { placeholder: "لو ده طلب منفصل فعلًا، اكتب السبب", value: form.draft.duplicateOverrideReason || "", oninput: event => { form.draft.duplicateOverrideReason = event.target.value; clearError(); } }),
      el("span", { class: "small muted", text: "السبب بيتسجل باسمك ويظهر للإدارة." })));
  }

  function refreshSuggestions() {
    const box = $("suggestions"); if (!box || !state.form || state.form.done) return;
    const form = state.form, draft = form.draft;
    const found = ChatwoodSuggest.extract(state.messages, { books: state.catalog.books, rows: state.catalog.index, knownPhone: draft.phone });
    const chips = [];
    const chip = (key, label, apply) => { if (form.applied.has(key)) return; chips.push(el("button", { type: "button", class: "chip", title: "اضغط عشان يتضاف", onclick: () => { form.applied.add(key); apply(); renderForm(); } }, label)); };
    if (found.name && found.name !== draft.customerName) chip(`name:${found.name}`, `👤 ${found.name}`, () => { draft.customerName = found.name; });
    for (const phone of found.phones.slice(0, 2)) if (phone !== draft.phone && phone !== draft.alternativePhone) chip(`phone:${phone}`, `📞 ${phone}`, () => { if (!draft.phone) draft.phone = phone; else draft.alternativePhone = phone; });
    const place = suggestedLocation(found);
    if (place.governorate && (place.governorate !== draft.governorate || (place.city && place.city !== draft.city)))
      chip(`gov:${place.governorate}:${place.city}`, `📍 ${place.governorate}${place.city ? ` · ${place.city}` : ""}`, () => { draft.governorate = place.governorate; draft.city = place.city || EgyptCities.canonicalCity(place.governorate, draft.city); });
    if (found.address && found.address !== draft.address) chip(`addr:${found.address}`, `🏠 ${found.address.length > 60 ? `${found.address.slice(0, 60)}…` : found.address}`, () => { draft.address = found.address; });
    for (const book of found.books) if (!draft.lines.some(line => line.bookId === book.id)) chip(`book:${book.id}`, `📚 ${book.name}`, () => addBook(book));
    box.replaceChildren(...(chips.length ? [el("span", { class: "small muted", text: "من رسايل العميل · اضغط يتضاف:" }), ...chips] : []));
  }

  // Common words that are also city names; they are not taken as a city when no governorate was written.
  const AMBIGUOUS_CITY_WORDS = new Set(["السلام", "دار السلام", "النهضه", "الشهداء", "الساحل", "الرياض", "الفتح", "الوقف", "الحمام", "باريس", "الظاهر", "الجمرك", "الزهور", "الجنوب", "الشرق", "العرب", "المناخ", "الضواحي", "الخليفه", "الزيتون", "فيصل", "ناصر", "بدر", "نصر", "طره", "بلاط", "نخل", "الطور"].map(EgyptCities.fold));

  function cityInside(texts, cities, skipAmbiguous) {
    const plain = ` ${texts.map(EgyptCities.fold).join(" ")} `;
    return cities.filter(name => { const key = EgyptCities.fold(name); return key.length >= 3 && !(skipAmbiguous && AMBIGUOUS_CITY_WORDS.has(key)) && plain.includes(` ${key} `); })
      .sort((a, b) => b.length - a.length)[0] || "";
  }

  function suggestedLocation(found) {
    const texts = [found.city, found.address].filter(Boolean);
    if (found.governorate) return { governorate: found.governorate, city: EgyptCities.canonicalCity(found.governorate, found.city) || cityInside(texts, EgyptCities.citiesOf(found.governorate), false) };
    const matches = EgyptCities.GOVERNORATES.map(governorate => ({ governorate, city: cityInside(texts, EgyptCities.citiesOf(governorate), true) })).filter(item => item.city);
    return matches.length === 1 ? matches[0] : { governorate: "", city: "" };
  }

  function refreshResults() {
    const box = $("book-results"); if (!box) return;
    const list = state.form.search.trim() ? ChatwoodSuggest.searchBooks(state.form.search, state.catalog.books, 8, state.catalog.index) : [];
    state.form.bookResults = list; if ((state.form.bookActive || 0) >= list.length) state.form.bookActive = 0;
    box.replaceChildren(...list.map((book, index) => el("button", { type: "button", class: `result ${index === (state.form.bookActive || 0) ? "active" : ""}`, onmousedown: event => event.preventDefault(), onclick: () => addBook(book) },
      el("span", { text: book.name }), el("small", { class: book.available > 0 ? "ok" : "warn", text: `${money(book.price)} · ${book.available > 0 ? `متاح ${book.available}` : "غير متاح · حجز مسبق"}` }))));
    if (state.form.search.trim() && !list.length) box.append(el("div", { class: "small muted", text: "مفيش كتاب بالاسم ده." }));
  }

  function refreshLines() {
    const box = $("form-lines"); if (!box) return;
    const draft = state.form.draft, locked = state.form.order && ["preparing", "needs_review"].includes(state.form.order.workflowStage);
    let computed = [];
    try { computed = totals(draft).lines; } catch {}
    box.replaceChildren(...(draft.lines.length ? draft.lines.map((line, index) => {
      const book = state.catalog.byId.get(line.bookId), available = availableFor(line), short = line.qty > available, priced = computed[index];
      const discounted = priced && priced.unitFinalPrice < priced.unitOriginalPrice;
      const priceText = line.fromStore ? "سعر الموقع وقت الحفظ" : discounted ? `${money(priced.unitFinalPrice)} بدل ${money(priced.unitOriginalPrice)}` : money(line.price);
      return el("div", { class: `line-wrap ${short ? "short" : ""}` }, el("div", { class: "line" },
        el("div", { class: "line-name" }, el("strong", { text: book?.name || line.bookId }),
          el("small", { class: short ? "warn" : "muted", text: `${priceText}${short ? (locked ? ` · مش متاح (المتاح ${available})` : available ? ` · ${available} متاح والباقي حجز مسبق` : " · حجز مسبق") : ""}` })),
        el("div", { class: "qty" },
          el("button", { type: "button", "aria-label": "أقل", onclick: () => { if (line.qty > 1) line.qty -= 1; else draft.lines.splice(index, 1); refreshLines(); refreshSuggestions(); } , text: "−" }),
          el("b", { text: String(line.qty) }),
          el("button", { type: "button", "aria-label": "أكتر", onclick: () => { line.qty += 1; refreshLines(); }, text: "+" }),
          el("button", { type: "button", class: "remove", "aria-label": "حذف", onclick: () => { draft.lines.splice(index, 1); refreshLines(); refreshSuggestions(); }, text: "✕" }))),
        lineDiscount(line));
    }) : [el("div", { class: "small muted", text: "لسه مفيش كتب. اكتب في البحث أو اضغط اقتراح من الشات." })]));
    refreshTotals();
  }

  // Discount per copy, as on the System's order screen: changing it needs «تعديل خصم النظام». Books already on a
  // website order keep the website's price and discount.
  function lineDiscount(line) {
    const fixed = state.form.order?.website, can = state.catalog.permissions.discount && !fixed;
    if (!can) return Number(line.discount) > 0 ? el("div", { class: "line-discount small muted", text: `خصم ${amount(line.discount)}${line.discountType === "amount" ? " ج.م للنسخة" : "%"}` }) : "";
    const input = el("input", { inputmode: "decimal", value: line.discount ? amount(line.discount) : "", placeholder: "0", "aria-label": "الخصم",
      oninput: event => { const value = Number(String(event.target.value).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)) || 0); if (Number.isFinite(value) && value >= 0) { line.discount = value; refreshLinePrices(); } } });
    return el("div", { class: "line-discount" }, el("span", { class: "small muted", text: "خصم" }), input,
      el("select", { "aria-label": "نوع الخصم", onchange: event => { line.discountType = event.target.value; refreshLinePrices(); } },
        el("option", { value: "percent", selected: line.discountType !== "amount", text: "%" }), el("option", { value: "amount", selected: line.discountType === "amount", text: "ج.م للنسخة" })));
  }

  // Updates prices and totals without rebuilding the inputs being typed in.
  function refreshLinePrices() {
    const draft = state.form.draft;
    let computed; try { computed = totals(draft).lines; } catch (error) { return formError(error.message); }
    clearError();
    document.querySelectorAll("#form-lines .line-wrap").forEach((row, index) => {
      const priced = computed[index], line = draft.lines[index], label = row.querySelector(".line-name small");
      if (!priced || !label || line.fromStore) return;
      const discounted = priced.unitFinalPrice < priced.unitOriginalPrice, extra = label.textContent.includes(" · ") ? label.textContent.slice(label.textContent.indexOf(" · ")) : "";
      label.textContent = `${discounted ? `${money(priced.unitFinalPrice)} بدل ${money(priced.unitOriginalPrice)}` : money(line.price)}${extra}`;
    });
    refreshTotals();
  }

  function orderDiscountField() {
    const draft = state.form.draft;
    if (!state.catalog.permissions.discount) return Number(draft.orderDiscount) > 0 ? el("div", { class: "small muted", text: `خصم على الطلب: ${amount(draft.orderDiscount)}${draft.orderDiscountType === "amount" ? " ج.م" : "%"}` }) : "";
    return el("div", { class: "line-discount order" }, el("span", { class: "small", text: "خصم إضافي على الطلب" }),
      el("input", { inputmode: "decimal", value: draft.orderDiscount ? amount(draft.orderDiscount) : "", placeholder: "0", "aria-label": "خصم الطلب",
        oninput: event => { const value = Number(String(event.target.value).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)) || 0); if (Number.isFinite(value) && value >= 0) { draft.orderDiscount = value; refreshTotals(); } } }),
      el("select", { "aria-label": "نوع خصم الطلب", onchange: event => { draft.orderDiscountType = event.target.value; refreshTotals(); } },
        el("option", { value: "percent", selected: draft.orderDiscountType !== "amount", text: "%" }), el("option", { value: "amount", selected: draft.orderDiscountType === "amount", text: "ج.م" })));
  }

  function refreshPayment() {
    const box = $("payment-fields"); if (!box) return;
    const draft = state.form.draft;
    if (draft.paymentPlan === "cash_on_delivery") { draft.paidAmount = 0; draft.paymentConfirmed = false; return box.replaceChildren(); }
    box.replaceChildren(el("div", { class: "grid" },
      el("label", { class: "field" }, el("span", { text: "المبلغ اللي وصل" }), el("input", { inputmode: "decimal", value: draft.paidAmount || "", oninput: event => { draft.paidAmount = Number(String(event.target.value).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))) || 0; refreshTotals(false); clearError(); } })),
      el("label", { class: "field" }, el("span", { text: "اتحوّل على" }), el("select", { onchange: event => { draft.cashAccountId = event.target.value; clearError(); } }, el("option", { value: "", text: "اختار الخزنة…" }), state.catalog.cashAccounts.map(account => el("option", { value: account.id, selected: account.id === draft.cashAccountId, text: account.name }))))),
      el("label", { class: "check" }, el("input", { type: "checkbox", checked: draft.paymentConfirmed, onchange: event => { draft.paymentConfirmed = event.target.checked; clearError(); } }), "اتأكدت إن المبلغ وصل فعلًا"));
  }

  function refreshTotals(updateShippingInput = true) {
    const box = $("form-totals"); if (!box || !state.form) return;
    const draft = state.form.draft;
    let result; try { result = totals(draft); } catch (error) { box.replaceChildren(el("div", { class: "small error", text: error.message })); return; }
    const label = $("shipping-label"); if (label) label.textContent = result.shipping ? money(result.shipping) : "مجاني";
    const input = $("shipping-input"); if (input && updateShippingInput && !draft.shippingManual) input.value = amount(result.shipping);
    const paid = Math.min(Number(draft.paidAmount || 0), result.total);
    const footer = $("footer-total"); if (footer) footer.textContent = `${money(result.total)}${draft.lines.length ? ` · ${draft.lines.reduce((sum, line) => sum + Number(line.qty || 0), 0)} كتاب` : ""}`;
    box.replaceChildren(
      result.productDiscountTotal ? el("div", {}, el("span", { text: "خصم الكتب" }), el("b", { text: `− ${money(result.productDiscountTotal)}` })) : "",
      el("div", {}, el("span", { text: "الكتب" }), el("b", { text: money(result.goods) })),
      el("div", {}, el("span", { text: "الشحن" }), el("b", { text: result.shipping ? money(result.shipping) : "مجاني" })),
      result.orderDiscountAmount ? el("div", {}, el("span", { text: "خصم الطلب" }), el("b", { text: `− ${money(result.orderDiscountAmount)}` })) : "",
      el("div", { class: "grand" }, el("span", { text: "الإجمالي" }), el("b", { text: money(result.total) })),
      paid ? el("div", {}, el("span", { text: "المتبقي عند الاستلام" }), el("b", { text: money(result.total - paid) })) : "");
  }

  function clearError() { const node = $("form-error"); if (node) node.textContent = ""; document.querySelectorAll(".order-form .invalid").forEach(item => item.classList.remove("invalid")); }
  function markInvalid(field) {
    const node = field && document.querySelector(`.order-form [data-field="${field}"]`); if (!node) return;
    node.classList.add("invalid"); node.scrollIntoView({ block: "center" });
    node.querySelector("input, select, textarea")?.focus({ preventScroll: true });
  }
  function formError(text) { const node = $("form-error"); if (node) { node.textContent = text; node.scrollIntoView({ block: "nearest" }); } }

  function validate(draft) {
    const bad = (field, text) => { state.form.invalidField = field; return text; };
    state.form.invalidField = "";
    if (!normalizePhone(draft.phone)) return bad("phone", "اكتب رقم موبايل مصري صحيح للمستلم.");
    if (!draft.customerName.trim()) return bad("customerName", "اكتب اسم العميل.");
    if (!draft.governorate.trim()) return bad("governorate", "اختار المحافظة.");
    if (!EgyptCities.GOVERNORATES.includes(draft.governorate.trim())) return bad("governorate", "اختار المحافظة من القايمة.");
    if (!draft.city.trim()) return bad("city", "اختار المدينة أو المركز.");
    if (!EgyptCities.canonicalCity(draft.governorate, draft.city)) return bad("city", `اختار المدينة من مدن ${draft.governorate}.`);
    if (!draft.address.trim()) return bad("address", "اكتب العنوان.");
    if (!draft.lines.length) return bad("lines", "ضيف كتاب واحد على الأقل.");
    if (state.form.mode === "create" && draft.paymentPlan !== "cash_on_delivery") {
      if (!(Number(draft.paidAmount) > 0)) return "اكتب المبلغ اللي وصل، أو اختار «الدفع عند الاستلام».";
      if (!draft.cashAccountId) return "اختار الخزنة اللي المبلغ اتحوّل عليها.";
      if (!draft.paymentConfirmed) return "علّم «اتأكدت إن المبلغ وصل فعلًا».";
    }
    if (state.form.order?.website && !draft.customerEdit.confirmed) return "طلب موقع: علّم «العميل هو اللي طلب التعديل ده».";
    if (state.form.order?.packed && !draft.reopenConfirmed) return "علّم «تمام، رجّعه للتغليف» عشان تحفظ التعديل.";
    const locked = state.form.order && ["preparing", "needs_review"].includes(state.form.order.workflowStage);
    if (locked && draft.lines.some(line => line.qty > availableFor(line))) return "التجهيز بدأ وفيه كتاب مش متاح؛ شيله أو قلّل الكمية، والناقص يتعمل له طلب منفصل.";
    return "";
  }

  function payloadOf(draft) {
    return { phone: normalizePhone(draft.phone), customerName: draft.customerName.trim(), alternativePhone: normalizePhone(draft.alternativePhone), governorate: draft.governorate.trim(), city: EgyptCities.canonicalCity(draft.governorate, draft.city) || draft.city.trim(), address: draft.address.trim(), addressMark: draft.addressMark.trim(),
      shippingCompany: draft.shippingCompany, shippingCost: draft.shippingCost, orderDiscount: draft.orderDiscount, orderDiscountType: draft.orderDiscountType, notes: draft.notes.trim(),
      lines: draft.lines.map(line => ({ bookId: line.bookId, qty: line.qty, discount: line.discount, discountType: line.discountType, discountScope: "unit" })) };
  }

  async function saveForm() {
    const form = state.form, draft = form.draft, button = $("form-save");
    if (form.saving) return;
    try { totals(draft); } catch (error) { return formError(error.message); }
    const problem = validate(draft); if (problem) { formError(problem); return markInvalid(form.invalidField); }
    const required = Number(state.catalog.depositRequired || 0), paidNow = form.mode === "create" && draft.paymentPlan !== "cash_on_delivery" ? Number(draft.paidAmount || 0) : 0;
    if (form.mode === "create" && required > 0 && paidNow < required && !confirm(paidNow ? `المبلغ اللي هيتسجّل ${money(paidNow)}، والعربون المطلوب ${money(required)}. متأكد؟` : `مفيش عربون، والعربون المطلوب ${money(required)}. تحفظ الطلب من غير عربون؟`)) return;
    form.saving = true; if (button) { button.disabled = true; button.textContent = "جارٍ الحفظ…"; }
    try {
      let order;
      if (form.mode === "create") {
        const body = { ...payloadOf(draft), requestId: draft.requestId, duplicateOverrideReason: draft.duplicateOverrideReason || "", chatwoodContext: state.data.orderContext?.token || "", paymentPlan: draft.paymentPlan, paymentMethod: PLAN_LABELS[draft.paymentPlan],
          paidAmount: draft.paymentPlan === "cash_on_delivery" ? 0 : Number(draft.paidAmount), paymentConfirmed: draft.paymentPlan !== "cash_on_delivery" && draft.paymentConfirmed, cashAccountId: draft.cashAccountId, receiptMethod: draft.receiptMethod };
        order = (await api("/api/orders/quick", { method: "POST", body: JSON.stringify(body) })).order;
        if (state.catalog.permissions.confirm && !order.confirmedAt) order = (await api(`/api/orders/${encodeURIComponent(order.id)}/confirm`, { method: "POST", body: "{}" })).order;
      } else {
        const current = form.order;
        if (current.packed && !form.reopened) {
          await api(`/api/orders/${encodeURIComponent(current.id)}/reopen-for-edit`, { method: "POST", body: JSON.stringify({ confirm: true, operationKey: `panel-reopen-${current.id}-${current.saleId || current.workflowStage}` }) });
          form.reopened = true;
        }
        const body = { ...payloadOf(draft), paymentPlan: draft.paymentPlan, paymentMethod: PLAN_LABELS[draft.paymentPlan] || "", paidAmount: draft.paidAmount, paymentConfirmed: false,
          ...(current.website ? { customerRequestedEdit: { confirmed: draft.customerEdit.confirmed, channel: draft.customerEdit.channel, note: draft.customerEdit.note } } : {}) };
        order = (await api(`/api/orders/${encodeURIComponent(current.id)}/quick`, { method: "PATCH", body: JSON.stringify(body) })).order;
      }
      form.done = { order, totals: totals(draft) };
      renderDone();
    } catch (error) {
      if (error.status === 401) return;
      const known = { CHATWOOD_CONTEXT_EXPIRED: "صلاحية ربط المحادثة انتهت؛ ارجع وافتح «طلب جديد» تاني.", CHATWOOD_CONTEXT_INVALID: "تعذر التحقق من المحادثة؛ ارجع وافتح «طلب جديد» تاني.",
        STORE_UNAVAILABLE: "المتجر مش بيرد دلوقتي، فمش عارفين سعر الكتاب على الموقع. ما اتحفظش حاجة؛ جرّب تاني.", BOOK_NOT_ON_WEBSITE: error.message, INSUFFICIENT_AVAILABLE_STOCK: error.message };
      if (error.code === "POSSIBLE_DUPLICATE_ORDER") { form.duplicateOrders = error.orders || []; refreshDuplicate(); $("duplicate-box")?.querySelector("input")?.focus(); }
      formError(known[error.code] || error.message);
    } finally {
      form.saving = false; if (button && !form.done) { button.disabled = false; button.textContent = form.mode === "create" ? (state.catalog.permissions.confirm ? "حفظ وتأكيد الطلب" : "حفظ الطلب") : "حفظ التعديل"; }
    }
  }

  function summaryText() {
    const { order, totals: result } = state.form.done, draft = state.form.draft;
    // Same wording as the main app's order message: a discounted book shows its price before the discount too.
    const rows = result.lines.map(line => {
      const name = String(state.catalog.byId.get(line.bookId)?.name || line.bookId).replace(/\s+/g, " ").trim();
      const price = line.unitFinalPrice < line.unitOriginalPrice ? `${amount(line.unitFinalPrice)} بدل ${amount(line.unitOriginalPrice)} ج` : `${amount(line.unitFinalPrice)} ج`;
      return line.qty > 1 ? `• ${line.qty} * ${name} | النسخة ${price} | الإجمالي ${amount(line.lineFinalAmount)} ج` : `• ${name} | ${price}`;
    }).join("\n");
    const orderDiscount = result.orderDiscountAmount ? `خصم الطلب: ${amount(result.orderDiscountAmount)} ج\n` : "";
    const total = Number(order.total ?? result.total), paid = Number(order.paidAmount || 0);
    const address = [draft.governorate, draft.city, draft.address].map(value => String(value || "").replace(/\s+/g, " ").trim()).filter(Boolean).join("، ");
    return `${order.confirmedAt ? "✅ تم تأكيد الطلب" : "📚 ملخص الطلب"}\nرقم الطلب: ${order.id}\n👤 ${draft.customerName} | 📞 ${draft.phone}\n📍 ${address}\n\n${rows}\n\n${orderDiscount}قيمة الكتب: ${amount(result.goods)} ج | الشحن: ${amount(result.shipping)} ج\nالإجمالي: ${amount(total)} ج\nالمدفوع: ${amount(paid)} ج | المتبقي عند الاستلام: ${amount(Math.max(0, total - paid))} ج`;
  }

  async function copySummary(button) {
    const text = summaryText();
    let copied = false;
    try { await navigator.clipboard.writeText(text); copied = true; } catch {}
    if (!copied) { const area = el("textarea", { class: "copy-area" }); area.value = text; document.body.append(area); area.select(); try { copied = document.execCommand("copy"); } catch {} area.remove(); }
    button.textContent = copied ? "✓ اتنسخت، الصقها في الرد" : "مقدرتش أنسخ؛ انسخها من الصندوق";
    if (!copied) $("summary-box")?.select();
  }

  function renderDone() {
    const { order } = state.form.done, stage = order.workflowStage === "awaiting_stock" ? "حجز مسبق: فيه كتب مستنية توريد" : order.confirmedAt ? "اتأكد وراح «جاهز للتغليف»" : "اتحفظ ومستني تأكيد";
    const box = el("textarea", { id: "summary-box", class: "summary", readonly: true, rows: 9 }); box.value = summaryText();
    $("orders-list").replaceChildren(el("section", { class: "card order-form done" },
      el("h2", { text: `${state.form.mode === "create" ? "✅ اتسجل الطلب" : "✅ اتحفظ التعديل"} ${order.id}` }),
      el("div", { class: "small muted", text: `${stage}${state.form.mode === "create" && order.chatwootConversationId ? ` · مربوط بالمحادثة #${order.chatwootConversationId}` : ""}${state.form.reopened ? " · رجع «جاهز للتغليف»" : ""}` }),
      box,
      el("div", { class: "actions" },
        el("button", { type: "button", class: "btn", onclick: event => copySummary(event.target), text: "نسخ الرسالة للعميل" }),
        state.form.mode === "create" && el("button", { type: "button", class: "btn ghost", onclick: () => { state.form = null; openCreateForm(); }, text: "طلب تاني" }),
        el("button", { type: "button", class: "btn ghost", onclick: closeForm, text: "رجوع للطلبات" }))));
  }

  function closeForm() { state.form = null; load(); }

  // A further payment on the order, recorded like the first one (payment and cash row) by the System.
  async function startPayment(order, actions) {
    try { await loadCatalog(); } catch (error) { if (error.status !== 401) message(error.message, "error"); return; }
    if (!state.catalog.permissions.receive) return message("مش عندك صلاحية تسجيل الدفعات.", "warning");
    const amountInput = el("input", { inputmode: "decimal", placeholder: `المبلغ (الباقي ${amount(order.remaining)})` });
    const account = el("select", {}, el("option", { value: "", text: "اتحوّل على…" }), state.catalog.cashAccounts.map(item => el("option", { value: item.id, text: item.name })));
    const method = el("select", {}, ["InstaPay", "محفظة إلكترونية", "تحويل بنكي", "كاش"].map(item => el("option", { text: item })));
    const sure = el("input", { type: "checkbox" }), key = `panel-payment-${order.salesOrderId}-${Date.now()}`;
    actions.replaceChildren(el("div", { class: "pay-form" }, el("div", { class: "two" }, amountInput, account), method,
      el("label", { class: "check" }, sure, "اتأكدت إن المبلغ وصل فعلًا"),
      el("div", { class: "actions" },
        el("button", { type: "button", class: "btn", onclick: async event => {
          const value = Number(String(amountInput.value).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[٫,]/g, "."));
          if (!(value > 0)) return message("اكتب المبلغ اللي وصل.", "error");
          if (!account.value) return message("اختار الخزنة اللي المبلغ اتحوّل عليها.", "error");
          if (!sure.checked) return message("علّم «اتأكدت إن المبلغ وصل فعلًا».", "error");
          event.target.disabled = true;
          try { await api(`/api/orders/${encodeURIComponent(order.salesOrderId)}/payments`, { method: "POST", body: JSON.stringify({ amount: value, cashAccountId: account.value, paymentMethod: method.value, operationKey: key }) }); message(`اتسجلت دفعة ${money(value)} على ${order.salesOrderId}.`, "ok"); load(); }
          catch (error) { event.target.disabled = false; if (error.status !== 401) message(error.message, "error"); }
        }, text: "تسجيل الدفعة" }),
        el("button", { type: "button", class: "btn ghost", onclick: () => load(), text: "تراجع" }))));
    amountInput.focus();
  }

  async function startCancel(orderId, actions) {
    let result;
    try { result = await api(`/api/integration/v1/panel/order?id=${encodeURIComponent(orderId)}`); }
    catch (error) { if (error.status !== 401) message(error.status === 403 ? "ليس لديك صلاحية إلغاء الطلبات." : error.message, "error"); return; }
    if (result.cancelBlock) return message(`${orderId}: ${result.cancelBlock}`, "warning");
    const select = el("select", {}, el("option", { value: "", text: "سبب الإلغاء…" }), CANCEL_REASONS.map(reason => el("option", { text: reason })));
    actions.replaceChildren(select,
      el("button", { type: "button", class: "btn danger", onclick: async () => {
        if (!select.value) return message("اختار سبب الإلغاء.", "error");
        try { await api(`/api/orders/${encodeURIComponent(orderId)}/cancel`, { method: "POST", body: JSON.stringify({ reason: select.value }) }); message(`اتلغى الطلب ${orderId}.`, "ok"); load(); }
        catch (error) { if (error.status !== 401) message(error.code === "PAYMENT_REFUND_REQUIRED" ? "الطلب فيه دفعة؛ الإلغاء مع رد الفلوس من السيستم." : error.message, "error"); }
      }, text: "تأكيد الإلغاء" }),
      el("button", { type: "button", class: "btn ghost", onclick: () => load(), text: "تراجع" }));
  }

  restoreSession();
})();
