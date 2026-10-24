"use strict";
// Egypt's 27 governorates with the cities, centres (مراكز) and city districts that belong to each one, for the city
// field of an order. A village belongs to its centre: the employee picks the centre and writes the village in the address.
// Built from the official level-2 divisions (open-admin-data/egypt-administrative-divisions, CC-BY-4.0) with the police
// sections merged into their city, spelling unified, and checked against the current boundaries (أرمنت and إسنا are in
// الأقصر since 2009, not قنا). Used by the browser (System and the Chatwood panel) and by the server.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EgyptCities = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const CITIES = {
    "القاهرة": [
      "مدينة نصر", "مصر الجديدة", "النزهة", "شيراتون", "مصر القديمة", "المنيل", "المعادي", "دار السلام", "البساتين", "المقطم",
      "حلوان", "المعصرة", "طرة", "التبين", "15 مايو", "السيدة زينب", "الخليفة", "الدرب الأحمر", "الجمالية", "الموسكي",
      "باب الشعرية", "الأزبكية", "عابدين", "وسط البلد", "قصر النيل", "جاردن سيتي", "الزمالك", "بولاق", "روض الفرج", "شبرا",
      "الساحل", "الشرابية", "الزاوية الحمراء", "حدائق القبة", "الوايلي", "العباسية", "الظاهر", "الزيتون", "حلمية الزيتون",
      "المطرية", "عين شمس", "المرج", "السلام", "النهضة", "منشأة ناصر", "القاهرة الجديدة", "التجمع الخامس", "الرحاب",
      "مدينتي", "الشروق", "بدر", "العاصمة الإدارية الجديدة"
    ],
    "الجيزة": [
      "الجيزة", "الدقي", "العجوزة", "المهندسين", "الهرم", "فيصل", "حدائق الأهرام", "العمرانية", "الطالبية", "المنيب",
      "بولاق الدكرور", "إمبابة", "الوراق", "6 أكتوبر", "حدائق أكتوبر", "الشيخ زايد", "أوسيم", "كرداسة", "أبو النمرس",
      "الحوامدية", "البدرشين", "العياط", "الصف", "أطفيح", "منشأة القناطر", "الواحات البحرية"
    ],
    "الإسكندرية": [
      "المنتزه", "المعمورة", "أبو قير", "المندرة", "العصافرة", "ميامي", "سيدي بشر", "الرمل", "سيدي جابر", "سموحة",
      "محرم بك", "باب شرقي", "العطارين", "المنشية", "الجمرك", "كرموز", "اللبان", "مينا البصل", "الدخيلة", "العجمي",
      "العامرية", "برج العرب", "برج العرب الجديدة"
    ],
    "القليوبية": ["بنها", "قليوب", "شبرا الخيمة", "القناطر الخيرية", "الخانكة", "الخصوص", "العبور", "شبين القناطر", "طوخ", "قها", "كفر شكر"],
    "الشرقية": [
      "الزقازيق", "العاشر من رمضان", "بلبيس", "منيا القمح", "مشتول السوق", "القنايات", "أبو حماد", "القرين", "ههيا", "أبو كبير",
      "فاقوس", "الصالحية الجديدة", "الإبراهيمية", "ديرب نجم", "كفر صقر", "أولاد صقر", "الحسينية", "صان الحجر", "منشأة أبو عمر"
    ],
    "الدقهلية": [
      "المنصورة", "المنصورة الجديدة", "طلخا", "ميت غمر", "دكرنس", "أجا", "منية النصر", "السنبلاوين", "الكردي", "بني عبيد",
      "المنزلة", "تمي الأمديد", "الجمالية", "شربين", "المطرية", "بلقاس", "ميت سلسيل", "جمصة", "محلة دمنة", "نبروه"
    ],
    "الغربية": ["طنطا", "المحلة الكبرى", "كفر الزيات", "زفتى", "السنطة", "قطور", "بسيون", "سمنود"],
    "المنوفية": ["شبين الكوم", "منوف", "مدينة السادات", "أشمون", "الباجور", "قويسنا", "بركة السبع", "تلا", "الشهداء", "سرس الليان"],
    "البحيرة": [
      "دمنهور", "كفر الدوار", "رشيد", "إدكو", "أبو المطامير", "أبو حمص", "الدلنجات", "المحمودية", "الرحمانية", "إيتاي البارود",
      "حوش عيسى", "شبراخيت", "كوم حمادة", "بدر", "وادي النطرون", "النوبارية الجديدة", "غرب النوبارية"
    ],
    "كفر الشيخ": ["كفر الشيخ", "دسوق", "فوه", "مطوبس", "البرلس", "بلطيم", "الحامول", "بيلا", "الرياض", "سيدي سالم", "قلين", "سيدي غازي"],
    "دمياط": ["دمياط", "دمياط الجديدة", "رأس البر", "فارسكور", "الزرقا", "كفر سعد", "كفر البطيخ", "السرو", "عزبة البرج", "ميت أبو غالب"],
    "بورسعيد": ["بورسعيد", "حي الشرق", "حي العرب", "حي المناخ", "حي الضواحي", "حي الزهور", "حي الجنوب", "حي غرب", "بورفؤاد"],
    "الإسماعيلية": ["الإسماعيلية", "فايد", "القنطرة غرب", "القنطرة شرق", "التل الكبير", "أبو صوير", "القصاصين"],
    "السويس": ["السويس", "الأربعين", "عتاقة", "الجناين", "فيصل"],
    "شمال سيناء": ["العريش", "الشيخ زويد", "رفح", "بئر العبد", "الحسنة", "نخل"],
    "جنوب سيناء": ["الطور", "شرم الشيخ", "دهب", "نويبع", "طابا", "سانت كاترين", "أبو رديس", "أبو زنيمة", "رأس سدر"],
    "البحر الأحمر": ["الغردقة", "الجونة", "رأس غارب", "سفاجا", "القصير", "مرسى علم", "الشلاتين", "حلايب"],
    "الفيوم": ["الفيوم", "الفيوم الجديدة", "سنورس", "إطسا", "طامية", "أبشواي", "يوسف الصديق"],
    "بني سويف": ["بني سويف", "بني سويف الجديدة", "الواسطى", "ناصر", "إهناسيا", "ببا", "سمسطا", "الفشن"],
    "المنيا": ["المنيا", "المنيا الجديدة", "العدوة", "مغاغة", "بني مزار", "مطاي", "سمالوط", "أبو قرقاص", "ملوي", "دير مواس"],
    "أسيوط": ["أسيوط", "أسيوط الجديدة", "ديروط", "القوصية", "منفلوط", "أبنوب", "الفتح", "أبو تيج", "الغنايم", "ساحل سليم", "البداري", "صدفا"],
    "سوهاج": ["سوهاج", "سوهاج الجديدة", "أخميم", "أخميم الجديدة", "البلينا", "المراغة", "المنشاة", "دار السلام", "جرجا", "جهينة", "ساقلتة", "طما", "طهطا", "العسيرات"],
    "قنا": ["قنا", "قنا الجديدة", "أبو تشت", "فرشوط", "نجع حمادي", "دشنا", "الوقف", "قفط", "قوص", "نقادة"],
    "الأقصر": ["الأقصر", "طيبة الجديدة", "أرمنت", "إسنا", "الطود", "القرنة", "الزينية", "البياضية"],
    "أسوان": ["أسوان", "أسوان الجديدة", "دراو", "كوم أمبو", "نصر النوبة", "إدفو", "أبو سمبل", "توشكى الجديدة"],
    "الوادي الجديد": ["الخارجة", "الداخلة", "الفرافرة", "باريس", "بلاط"],
    "مطروح": ["مرسى مطروح", "الحمام", "العلمين", "العلمين الجديدة", "الضبعة", "النجيلة", "سيدي براني", "السلوم", "سيوة", "الساحل الشمالي"]
  };

  function fold(value) {
    return String(value || "")
      .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
      .replace(/[ً-ٰٟـ]/g, "")
      .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
      .replace(/^(مركز|قسم|مدينه|حي)\s+/, "").replace(/^(اول|ثان|ثاني|ثالث|رابع)\s+/, "")
      .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  }

  function citiesOf(governorate) { return CITIES[String(governorate || "").trim()] || []; }

  // The list's own spelling of a city typed or suggested in another spelling («ميت غمر», «مركز ميت غمر»), or "".
  function canonicalCity(governorate, city) {
    const wanted = fold(city);
    if (!wanted) return "";
    return citiesOf(governorate).find(name => fold(name) === wanted) || "";
  }

  // Governorates whose list contains this city; one entry when the name is unique in Egypt.
  function governoratesOfCity(city) {
    const wanted = fold(city);
    if (!wanted) return [];
    return Object.keys(CITIES).filter(governorate => CITIES[governorate].some(name => fold(name) === wanted));
  }

  // How well a typed text matches a name: lower is better, -1 is no match. Tolerates ه/ة, أ/ا, ى/ي, a missing «ال»,
  // missing spaces («بورسعيد» / «بور سعيد») and one wrong letter in a word of four letters or more.
  function matchScore(name, query) {
    const q = fold(query), n = fold(name);
    if (!q) return 0;
    const bare = text => text.split(" ").map(word => word.replace(/^ال(?=..)/, "")).join(" ");
    // Each tier first as typed, then without «ال» (half a point worse), so «المحله» puts «المحلة الكبرى» first.
    const tiers = [
      (a, b) => a === b || a.replace(/ /g, "") === b.replace(/ /g, ""),
      (a, b) => a.startsWith(b) || a.replace(/ /g, "").startsWith(b.replace(/ /g, "")),
      (a, b) => a.split(" ").some(word => word.startsWith(b)),
      (a, b) => b.length >= 2 && a.includes(b)
    ];
    for (let tier = 0; tier < tiers.length; tier++) {
      if (tiers[tier](n, q)) return tier;
      if (tiers[tier](bare(n), bare(q)) || tiers[tier](n, bare(q))) return tier + 0.5;
    }
    const words = bare(n).split(" "), typed = bare(q).split(" ").filter(Boolean);
    if (typed.length && typed.every(word => word.length >= 4 && words.some(candidate => nearlySame(candidate, word)))) return 4;
    return -1;
  }

  function nearlySame(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }

  const GOVERNORATE_ALIASES = { "مصر": "القاهرة", "كايرو": "القاهرة", "اسكندريه": "الإسكندرية", "اسكندرية": "الإسكندرية", "الاسكندرية": "الإسكندرية", "اسماعيليه": "الإسماعيلية", "الواحات": "الوادي الجديد", "سينا": "شمال سيناء" };

  // Governorates for a typed text, best first. A city name finds its governorate too («ميت غمر» → الدقهلية).
  function searchGovernorates(query, limit = 27) {
    const out = [];
    for (const governorate of Object.keys(CITIES)) {
      const score = matchScore(governorate, query);
      if (score >= 0) out.push({ governorate, city: "", score });
    }
    const alias = GOVERNORATE_ALIASES[fold(query)];
    if (alias && !out.some(item => item.governorate === alias)) out.push({ governorate: alias, city: "", score: 1 });
    if (fold(query).length >= 3) for (const item of searchCities(query, "", 8)) if (!out.some(row => row.governorate === item.governorate && !row.city)) out.push({ ...item, score: item.score + 5 });
    return withoutGuesses(out).sort((a, b) => a.score - b.score || a.governorate.localeCompare(b.governorate, "ar")).slice(0, limit);
  }

  // A one-letter-typo guess is offered only when nothing matches as written.
  function withoutGuesses(rows) { return rows.some(row => row.score < 4) ? rows.filter(row => row.score < 4) : rows; }

  // Cities for a typed text: of one governorate when it is chosen, otherwise of all of Egypt with their governorate.
  function searchCities(query, governorate = "", limit = 60) {
    const pool = governorate ? citiesOf(governorate).map(city => ({ governorate, city })) : Object.entries(CITIES).flatMap(([gov, cities]) => cities.map(city => ({ governorate: gov, city })));
    return withoutGuesses(pool.map((item, index) => ({ ...item, index, score: matchScore(item.city, query) })).filter(item => item.score >= 0))
      .sort((a, b) => a.score - b.score || a.index - b.index).slice(0, limit).map(({ index, ...item }) => item);
  }

  return { CITIES, GOVERNORATES: Object.keys(CITIES), citiesOf, canonicalCity, governoratesOfCity, fold, matchScore, searchGovernorates, searchCities };
});
