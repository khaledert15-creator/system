const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const ShippingBatchXlsx = require("../app/shipping-batch-xlsx.js");

const app = fs.readFileSync("app/app.js", "utf8");
const context = {};
vm.createContext(context);
vm.runInContext(app.slice(app.indexOf("function normalizePhone(value) {"), app.indexOf("function normalizeTrackingNumber(")), context);
const { phonesText, customerHasPhone } = context;

// Shown next to the main phone, once, with Arabic digits counted as the same number.
assert.equal(phonesText({ phone:"01226501840", alternativePhone:"01011112222" }), "01226501840 / 01011112222");
assert.equal(phonesText({ phone:"01226501840", alternativePhone:"٠١٢٢٦٥٠١٨٤٠" }), "01226501840");
assert.equal(phonesText({ alternativePhone:"01011112222" }), "01011112222");
assert.equal(phonesText(undefined, "—"), "—");

// A customer is matched by either number.
const customer = { phone:"01226501840", alternativePhone:"01011112222" };
assert.equal(customerHasPhone(customer, "01011112222"), true);
assert.equal(customerHasPhone(customer, "٠١٢٢٦٥٠١٨٤٠"), true);
assert.equal(customerHasPhone(customer, "01099999999"), false);
assert.equal(customerHasPhone(customer, ""), false);

// The waybill's address column carries the alternative phone.
const order = { id:"ORD-1", customerName:"عميل", phone:"01226501840", alternativePhone:"01011112222", governorate:"الإسكندرية", city:"فكتوريا", address:"ميدان الساعة", lines:[], total:100, packedWeightGrams:500 };
const street = ShippingBatchXlsx.orderToUploadRow(order)[ShippingBatchXlsx.UPLOAD_HEADERS.indexOf("Street")];
assert.equal(street, "ميدان الساعة - فكتوريا /رقم اضافي للعميل 01011112222");
const sameNumber = ShippingBatchXlsx.orderToUploadRow({ ...order, alternativePhone:"01226501840" })[ShippingBatchXlsx.UPLOAD_HEADERS.indexOf("Street")];
assert.equal(sameNumber, "ميدان الساعة - فكتوريا");

// The server looks customers up by the alternative phone and fills it into the waybill from the customer.
const server = fs.readFileSync("server-node.js", "utf8");
assert.match(server, /normalizeCustomerPhone\(item\.alternativePhone\)===phone/);
assert.match(server, /orderToUploadRow\(\{\.\.\.order,alternativePhone:order\.alternativePhone\|\|/);

console.log("alternative phone tests passed");
