#!/usr/bin/env node
"use strict";
// Source checks for the website-orders UI wiring in app/app.js (the behaviour itself is covered by the API tests).
const assert = require("assert"), fs = require("fs"), path = require("path");
const app = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");
const pass = (name, fn) => { fn(); console.log(`PASS ${name}`); };

pass("permission keys are editable and default to the spec roles", () => {
  for (const key of ["order.website.view", "order.website.approve", "order.deposit.override", "panel.view", "panel.link"]) assert.ok(app.includes(`["${key}",`), key);
  assert.match(app, /"order\.website\.view":\["مالك","مدير","كاشير"\],"order\.website\.approve":\["مالك","مدير","كاشير"\],"order\.deposit\.override":\["مالك","مدير"\]/);
  assert.match(app, /"panel\.view":\["مالك","مدير","محاسب","كاشير","مخزن","شحن"\],"panel\.link":\["مالك","مدير","كاشير"\]/);
});
pass("book form saves allowPreorder through the normal client save", () => {
  assert.match(app, /name="allowPreorder" value="true"[^>]*> يسمح بالحجز المسبق/);
  assert.match(app, /allowPreorder: formData\.allowPreorder === "true"/);
  assert.match(app, /function bookEditFingerprint[\s\S]*book\.allowPreorder === true/);
});
pass("online orders have a website tab that loads from the server", () => {
  assert.match(app, /\["website","طلبات الموقع",canAction\("order\.website\.view"\)\]/);
  assert.match(app, /onlineOrdersMode==="website"&&canAction\("order\.website\.view"\)\)\{root\.innerHTML=renderWebsiteOrdersScreen\(\)/);
  assert.match(app, /websiteOrdersFetch\("\/api\/website-orders\?state=pending"\)/);
});
pass("detail shows per-line availability and the approval form fields", () => {
  for (const label of ["متوفر", "حجز مسبق", "غير متوفر", "تم استلام المبلغ فعليًا", "العربون المستلم", "طريقة الاستلام", "الخزنة / الحساب", "رقم المحوّل", "اسم المحوّل", "مرجع التحويل", "راجعت فرق الأسعار", "اعتماد وإنشاء طلب مبيعات"]) assert.ok(app.includes(label), label);
  assert.match(app, /name="preorder:\$\{esc\(line\.bookId\)\}"/);
  assert.match(app, /\/api\/website-orders\/\$\{encodeURIComponent\(form\.dataset\.number\)\}\/approve/);
  assert.match(app, /form\.id==="website-order-approve-form"\)\{await submitWebsiteOrderApproval\(form\)/);
});
pass("success opens the created order and website orders carry a badge", () => {
  assert.match(app, /function submitWebsiteOrderApproval[\s\S]*viewOnlineOrder\(result\.order\.id\)/);
  assert.match(app, /order\.websiteOrderNumber\?`<br><span class="badge website-order-badge"/);
  assert.match(app, /if \(kind === "order"\) \{[\s\S]*viewOnlineOrder\(id\)/);
});
pass("settings expose the website deposit default for owner/manager", () => {
  assert.match(app, /id="website-deposit-default"/);
  assert.match(app, /"save-website-deposit":\["مالك","مدير"\]/);
  assert.match(app, /orderWorkflowRequest\("\/api\/settings\/website-deposit",\{method:"PUT",body:\{depositDefault:value,expectedRevision:dbRevision\}\}\)/);
});
console.log("6/6 website orders UI checks passed");
