"use strict";
// Chatwood dashboard-app tab. Chatwood tells us the open conversation through postMessage; identity and permissions
// come only from a System login inside this tab (Chatwood data alone is never trusted). Read-only except the explicit
// «ربط بهذه المحادثة» action on one order the employee picks.
(function () {
  const CHATWOOD_ORIGIN = document.querySelector('meta[name="chatwood-origin"]')?.content || "";
  const TOKEN_KEY = "maktabaa-chatwood-panel-session";
  const state = { token: sessionStorage.getItem(TOKEN_KEY) || "", user: null, phone: "", rawPhone: "", conversationId: "", contactName: "", data: null, loading: false };
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
    if (!response.ok) throw Object.assign(new Error(body.message || "تعذر تنفيذ الطلب."), { status: response.status, code: body.code });
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
    const changed = conversationId !== state.conversationId || rawPhone !== state.rawPhone;
    state.conversationId = /^\d{1,18}$/.test(conversationId) ? conversationId : "";
    state.rawPhone = rawPhone; state.phone = normalizePhone(rawPhone); state.contactName = String(contact.name || "");
    if (!state.phone) $("manual-hint").textContent = rawPhone ? "رقم جهة الاتصال ليس رقم موبايل مصري. اكتب رقم العميل يدويًا." : "جهة الاتصال بدون رقم هاتف. اكتب رقم العميل يدويًا.";
    if (changed && state.user) showContext();
  });
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
      $("orders-list").replaceChildren(el("div", { class: "card state" }, el("strong", { text: state.phone ? "الرقم ده مش مسجل في السيستم ولا في الموقع." : "مفيش طلبات مربوطة بالمحادثة دي، وجهة الاتصال مفيهاش رقم موبايل مصري." }), el("span", { class: "muted", text: "لو العميل طلب برقم تاني، اكتبه يدويًا." })));
      $("manual-form").hidden = false;
      return;
    }
    if (!orders.length) { $("orders-list").replaceChildren(el("div", { class: "card state" }, el("strong", { text: "العميل مسجل ومفيش له طلبات." }))); return; }
    const section = (title, phases) => {
      const groups = phases.map(phase => [phase, orders.filter(order => order.phase === phase)]).filter(([, list]) => list.length);
      if (!groups.length) return el("section", { class: "orders-section" }, el("h2", { text: `${title} (0)` }), el("p", { class: "muted small", text: "لا يوجد." }));
      return el("section", { class: "orders-section" }, el("h2", { text: `${title} (${groups.reduce((sum, [, list]) => sum + list.length, 0)})` }),
        groups.map(([phase, list]) => el("div", { class: "phase" }, el("h3", { text: `${PHASE_TITLES[phase]} (${list.length})` }), list.map(orderCard))));
    };
    $("orders-list").replaceChildren(section("الطلبات الحالية", CURRENT), section("سجل الطلبات", HISTORY),
      state.data.truncated ? el("p", { class: "muted small", text: `يظهر أحدث ${orders.length} من ${state.data.totalOrders} طلب.` }) : "");
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
      el("div", { class: "muted small" }, order.createdAt ? dateLabel(order.createdAt) : "بدون تاريخ", order.status && order.phaseLabel && order.status !== order.phaseLabel ? ` · ${order.status}` : "", order.matchedBy === "conversation" ? " · مربوط بالمحادثة (رقم الطلب مختلف)" : ""),
      el("ul", { class: "products" }, (order.products || []).slice(0, 8).map(item => el("li", {}, `${item.name} × ${item.qty}`))),
      el("div", { class: "stats four" },
        el("div", {}, el("span", { text: "الإجمالي" }), el("b", { text: money(order.total) })),
        el("div", {}, el("span", { text: "العربون المطلوب" }), el("b", { text: order.depositRequired == null ? "—" : money(order.depositRequired) })),
        el("div", {}, el("span", { text: "المدفوع" }), el("b", { text: money(order.paid) })),
        el("div", {}, el("span", { text: "المتبقي" }), el("b", { class: order.remaining > 0 ? "due" : "", text: money(order.remaining) }))),
      el("div", { class: "muted small" }, `الشحن: ${shipment}`, order.trackingNumber ? el("span", { dir: "ltr", class: "tracking", text: ` ${order.trackingNumber}` }) : ""),
      order.linkedToConversation ? el("div", { class: "small ok", text: "✓ مربوط بهذه المحادثة" }) : order.chatwootConversationId ? el("div", { class: "small muted", text: `مربوط بمحادثة أخرى #${order.chatwootConversationId}` }) : "",
      el("div", { class: "actions" },
        order.links?.system && el("a", { class: "btn ghost", href: order.links.system, target: "_blank", rel: "noopener noreferrer", text: "فتح في السيستم" }),
        order.links?.store && el("a", { class: "btn ghost", href: order.links.store, target: "_blank", rel: "noopener noreferrer", text: "فتح في لوحة المتجر" }),
        canLink && el("button", { type: "button", class: "btn", onclick: () => linkConversation(order), text: "ربط بهذه المحادثة" })));
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

  restoreSession();
})();
