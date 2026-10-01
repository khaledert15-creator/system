const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const app = fs.readFileSync(path.join(__dirname, "..", "app", "app.js"), "utf8");
const source = app.match(/function documentDisplayName\([\s\S]*?\n}\n/)?.[0];
assert(source, "documentDisplayName helper must exist");
const context = {};
vm.createContext(context);
vm.runInContext(`${source}; this.documentDisplayName = documentDisplayName;`, context);
const display = context.documentDisplayName;

assert.match(display("INV-112", "sale"), /^مبيعات\s+١١٢$/);
assert.match(display("SAL-7"), /^مبيعات\s+٧$/);
assert.match(display("PUR-055", "purchase"), /^مشتريات\s+٥٥$/);
assert.match(display("RET-50", "return"), /^مرتجع\s+٥٠$/);
assert.match(display("ORD-19", "order"), /^طلب\s+١٩$/);
assert(app.includes('documentDisplayName(sale.id, "sale")'));
assert(app.includes('documentDisplayName(p.id, "purchase")'));
assert(app.includes('documentDisplayName(returnNo(item), "return")'));
console.log("PASS document display names use Arabic operation labels without technical prefixes");
