(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Permissions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // The screens each role opens by default. The page shows them and the server uses the same table to decide which
  // data a whole-database save from that user may change, so the two can never disagree.
  const ROLE_VIEWS = Object.freeze({
    "مالك": ["dashboard","books","sales","onlineOrders","purchases","returns","parties","shipping","accounting","reports","hr","omnichannel","settings"],
    "مدير": ["dashboard","books","sales","onlineOrders","purchases","returns","parties","shipping","accounting","reports","hr","omnichannel","settings"],
    "محاسب": ["dashboard","books","sales","onlineOrders","purchases","returns","parties","accounting","reports"],
    "كاشير": ["dashboard","sales","onlineOrders","returns","parties","omnichannel"],
    "مخزن": ["dashboard","books","onlineOrders","purchases","returns","shipping"],
    "شحن": ["dashboard","onlineOrders","shipping","omnichannel"]
  });
  const ROLE_NAMES = Object.freeze({ owner:"مالك", manager:"مدير", accountant:"محاسب", cashier:"كاشير", warehouse:"مخزن", shipping:"شحن" });

  function roleOf(user = {}) {
    return ROLE_NAMES[user.role] || user.role || "";
  }

  function defaultViews(role) {
    const views = [...(ROLE_VIEWS[role] || [])];
    if (!views.includes("omnichannel")) views.push("omnichannel");
    return views;
  }

  // Screens a user can open: their own saved list, else their role's saved list, else the role's defaults.
  function viewsFor(settings = {}, user = {}) {
    const role = roleOf(user), saved = settings?.permissions || {};
    const own = saved.users?.[user.username]?.views, byRole = saved.roles?.[role]?.views;
    if (Array.isArray(own)) return own;
    if (Array.isArray(byRole)) return byRole;
    return defaultViews(role);
  }

  return { ROLE_VIEWS, ROLE_NAMES, roleOf, defaultViews, viewsFor };
});
