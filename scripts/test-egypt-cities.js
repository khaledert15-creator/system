#!/usr/bin/env node
"use strict";
// The city list behind the order forms: the same 27 governorates everywhere, each city only under its own governorate,
// spellings customers and the old Store data use mapped to the list, and the server refusing an order without a city
// of the chosen governorate.
const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const EgyptCities = require("../app/egypt-cities.js");
const Suggest = require("../app/integrations/chatwood-suggest.js");
const pass = (name, fn) => { fn(); console.log(`PASS ${name}`); };

pass("the 27 governorates match the System and the panel", () => {
  const app = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");
  const systemList = vm.runInNewContext(`(${app.slice(app.indexOf("["), app.indexOf("];") + 1)})`);
  assert.equal(EgyptCities.GOVERNORATES.length, 27);
  assert.deepEqual([...EgyptCities.GOVERNORATES].sort(), [...systemList].sort());
  assert.deepEqual([...EgyptCities.GOVERNORATES].sort(), [...Suggest.GOVERNORATES].sort());
});

pass("every governorate has cities, none repeated inside a governorate", () => {
  for (const [governorate, cities] of Object.entries(EgyptCities.CITIES)) {
    assert.ok(cities.length >= 5, governorate);
    assert.equal(new Set(cities).size, cities.length, `${governorate} has a repeated city`);
  }
});

pass("cities sit under their current governorate", () => {
  for (const [city, governorate] of [["أرمنت", "الأقصر"], ["إسنا", "الأقصر"], ["ميت غمر", "الدقهلية"], ["العبور", "القليوبية"], ["6 أكتوبر", "الجيزة"],
    ["العاشر من رمضان", "الشرقية"], ["مدينة السادات", "المنوفية"], ["أبو صوير", "الإسماعيلية"], ["نجع حمادي", "قنا"], ["سيوة", "مطروح"]])
    assert.deepEqual(EgyptCities.governoratesOfCity(city), [governorate], city);
  assert.equal(EgyptCities.canonicalCity("قنا", "إسنا"), "", "إسنا is not in قنا");
  assert.deepEqual(EgyptCities.governoratesOfCity("المطرية").sort(), ["الدقهلية", "القاهرة"].sort(), "same name in two governorates");
});

pass("other spellings map to the list", () => {
  assert.equal(EgyptCities.canonicalCity("الدقهلية", "مركز ميت غمر"), "ميت غمر");
  assert.equal(EgyptCities.canonicalCity("الشرقية", "قسم اول الزقازيق"), "الزقازيق");
  assert.equal(EgyptCities.canonicalCity("الشرقية", "الابراهيميه"), "الإبراهيمية");
  assert.equal(EgyptCities.canonicalCity("القاهرة", "مدينه نصر"), "مدينة نصر");
  assert.equal(EgyptCities.canonicalCity("القاهرة", ""), "");
});

pass("smart search finds governorates and cities the way customers write them", () => {
  const gov = query => EgyptCities.searchGovernorates(query, 3).map(item => item.city ? `${item.governorate}·${item.city}` : item.governorate);
  assert.equal(gov("اسكندريه")[0], "الإسكندرية");
  assert.equal(gov("بور سعيد")[0], "بورسعيد");
  assert.equal(gov("دقهليه")[0], "الدقهلية");
  assert.equal(gov("سوهج")[0], "سوهاج", "one wrong letter");
  assert.equal(gov("مصر")[0], "القاهرة");
  assert.equal(gov("ميت غمر")[0], "الدقهلية·ميت غمر", "a city finds its governorate");
  const city = (query, governorate = "") => EgyptCities.searchCities(query, governorate, 3).map(item => governorate ? item.city : `${item.city}·${item.governorate}`);
  assert.deepEqual(city("منصوره", "الدقهلية"), ["المنصورة", "المنصورة الجديدة"]);
  assert.equal(city("تجمع", "القاهرة")[0], "التجمع الخامس");
  assert.equal(city("المحله")[0], "المحلة الكبرى·الغربية", "«ال» as typed ranks first");
  assert.deepEqual(city("طنطا"), ["طنطا·الغربية"], "no typo guesses when the name matches");
  assert.deepEqual(city("طنتا"), ["طنطا·الغربية"], "a typo still finds it");
  assert.deepEqual(city("طنطا", "الدقهلية"), [], "only the chosen governorate's cities");
});

pass("the server requires a city of the chosen governorate and stores the list spelling", () => {
  const server = fs.readFileSync(path.join(__dirname, "../server-node.js"), "utf8");
  const extract = name => {
    const start = server.indexOf(`function ${name}(`);
    let parens = 0, j = server.indexOf("(", start);
    for (; j < server.length; j++) { if (server[j] === "(") parens++; else if (server[j] === ")" && --parens === 0) break; }
    let depth = 0, i = server.indexOf("{", j);
    for (; i < server.length; i++) { if (server[i] === "{") depth++; else if (server[i] === "}" && --depth === 0) break; }
    return server.slice(start, i + 1);
  };
  const sandbox = { EgyptCities };
  vm.createContext(sandbox);
  vm.runInContext(["quickOrderCity", "quickOrderMissingCustomerFields", "quickOrderValidationMessage"].map(extract).join("\n"), sandbox);
  const base = { customerName: "QA", governorate: "القاهرة", address: "شارع 1" };
  assert.deepEqual(sandbox.quickOrderMissingCustomerFields({ ...base }, {}), ["city"]);
  assert.deepEqual(sandbox.quickOrderMissingCustomerFields({ ...base, city: "طنطا" }, {}), ["city"], "a city of another governorate is refused");
  assert.deepEqual(sandbox.quickOrderMissingCustomerFields({ ...base, city: "مدينه نصر" }, {}), []);
  assert.equal(sandbox.quickOrderCity({ ...base, city: "مدينه نصر" }, {}), "مدينة نصر");
  assert.deepEqual(sandbox.quickOrderMissingCustomerFields({ customerName: "QA", address: "x" }, { governorate: "الغربية", city: "طنطا" }), [], "the saved customer's city counts");
  assert.match(sandbox.quickOrderValidationMessage(["city"]), /المدينة/);
});
console.log("Egypt cities tests completed.");
