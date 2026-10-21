"use strict";
// Suggestions for the order form in the Chatwood panel, read from the conversation's messages that Chatwood already
// sends the panel. Runs in the employee's browser only: nothing here is sent or stored, and a suggestion is applied
// only when the employee taps it. Also a book search tolerant of how customers write names (تالتة، كيميا، 3 ثانوي).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ChatwoodSuggest = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const GOVERNORATES = [
    "القاهرة", "الجيزة", "الإسكندرية", "الدقهلية", "البحر الأحمر", "البحيرة", "الفيوم",
    "الغربية", "الإسماعيلية", "المنوفية", "المنيا", "القليوبية", "الوادي الجديد", "السويس",
    "أسوان", "أسيوط", "بني سويف", "بورسعيد", "دمياط", "الشرقية", "جنوب سيناء",
    "كفر الشيخ", "مطروح", "الأقصر", "قنا", "شمال سيناء", "سوهاج"
  ];
  // Well-known cities and districts customers write instead of the governorate.
  const CITY_GOVERNORATE = {
    "مدينه نصر": "القاهرة", "المعادي": "القاهرة", "حلوان": "القاهرة", "مصر الجديده": "القاهرة", "شبرا": "القاهرة", "المقطم": "القاهرة", "التجمع": "القاهرة", "عين شمس": "القاهرة", "المرج": "القاهرة",
    "6 اكتوبر": "الجيزة", "اكتوبر": "الجيزة", "الشيخ زايد": "الجيزة", "الهرم": "الجيزة", "فيصل": "الجيزة", "امبابه": "الجيزة", "الدقي": "الجيزة",
    "شبرا الخيمه": "القليوبية", "بنها": "القليوبية", "قليوب": "القليوبية", "المنصوره": "الدقهلية", "ميت غمر": "الدقهلية", "طنطا": "الغربية", "المحله": "الغربية",
    "الزقازيق": "الشرقية", "العاشر من رمضان": "الشرقية", "شبين الكوم": "المنوفية", "دمنهور": "البحيرة", "العريش": "شمال سيناء", "الغردقه": "البحر الأحمر", "مرسي مطروح": "مطروح"
  };
  const ADDRESS_WORDS = ["شارع", "ش", "عماره", "عمارة", "برج", "الدور", "دور", "شقه", "بجوار", "امام", "خلف", "منطقه", "قريه", "مركز", "حي", "ميدان", "بلوك", "مدخل"];
  const GRADE_WORDS = { "اولي": "1", "اول": "1", "تانيه": "2", "تاني": "2", "ثانيه": "2", "ثاني": "2", "تالته": "3", "تالت": "3", "ثالثه": "3", "ثالث": "3" };
  const STAGE_LETTERS = { "ثانوي": "ث", "اعدادي": "ع", "ابتدائي": "ب" };
  // How students write subjects, folded to the word book names use.
  const SYNONYMS = { "انجلش": "انجليزي", "انجليش": "انجليزي", "انجلیزي": "انجليزي", "ماث": "رياضيات", "رياضه": "رياضيات", "رياضة": "رياضيات", "بيولوجي": "احياء", "بيولوجيا": "احياء", "كمياء": "كيميا", "فزيا": "فيزيا", "فيزيقا": "فيزيا" };
  const GENERIC = ["كتاب", "شرح", "ترم", "مراجعه", "نسخه", "عاوز", "محتاج", "معاهم", "عايز", "لو", "سمحت", "ممكن"];

  function normalize(value) {
    return String(value || "")
      .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
      .replace(/[ً-ٰٟـ]/g, "")
      .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/ء/g, "")
      .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  }

  // «تالتة ثانوي», «3 ثانوي», «الصف الثالث الثانوي» and «3ث» all become the token «3ث», as book names write it.
  function gradeTokens(text) {
    const words = normalize(text).split(" ").map(word => word.replace(/^ال(?=..)/, ""));
    const out = [];
    for (let i = 0; i < words.length; i++) {
      const glued = words[i].match(/^([1-6])([ثعب])$/);
      if (glued) { out.push(glued[1] + glued[2]); continue; }
      const number = /^[1-6]$/.test(words[i]) ? words[i] : GRADE_WORDS[words[i]];
      const stage = STAGE_LETTERS[words[i + 1]] || STAGE_LETTERS[words[i + 2]];
      if (number && stage) out.push(number + stage);
    }
    return out;
  }

  function tokens(text) {
    return normalize(text).split(" ").map(word => word.replace(/^و(?=ال...)/, "").replace(/^ال(?=...)/, "")).map(word => SYNONYMS[word] || word).filter(word => word.length >= 2 && !/^\d$/.test(word));
  }

  function close(a, b) {
    if (a === b) return true;
    if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
    if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }

  // Grade codes and words like كتاب or شرح do not identify a book on their own.
  function bookIndex(books) {
    const rows = books.map(book => ({ book, words: [...new Set(tokens(book.name))], grades: gradeTokens(book.name) }));
    for (const row of rows) row.key = row.words.filter(word => !/^\d+[ثعب]?$/.test(word) && !GENERIC.includes(word));
    return rows;
  }

  // Books that match the text, best first; weaker matches far below the best one are left out. A grade written in the
  // text (or, failing that, the one grade used in the conversation) excludes books of another grade.
  function scoreBooks(text, rows, contextGrades = []) {
    const words = tokens(text), own = gradeTokens(text), grades = own.length ? own : contextGrades;
    const results = [];
    for (const row of rows) {
      const keyHits = row.key.filter(word => words.some(w => close(w, word))).length;
      if (!keyHits) continue;
      if (grades.length && row.grades.length && !row.grades.some(grade => grades.includes(grade))) continue;
      const allHits = row.words.filter(word => words.some(w => close(w, word))).length;
      const gradeHit = grades.length && row.grades.some(grade => grades.includes(grade)) ? 1 : 0;
      results.push({ book: row.book, score: keyHits * 3 + allHits + gradeHit * 2 + keyHits / Math.max(1, row.key.length) });
    }
    results.sort((a, b) => b.score - a.score);
    return results.filter(item => item.score >= results[0]?.score * 0.6);
  }

  function searchBooks(query, books, limit = 8, rows = bookIndex(books)) {
    if (!normalize(query)) return [];
    const direct = normalize(query);
    const scored = scoreBooks(query, rows);
    // A typed word that is part of a name (e.g. the start of «نيوتن») also matches while typing.
    const partial = rows.filter(row => normalize(row.book.name).includes(direct) && !scored.some(item => item.book === row.book)).map(row => ({ book: row.book, score: 0.5 }));
    return [...scored, ...partial].slice(0, limit).map(item => item.book);
  }

  function normalizePhone(value) {
    let digits = normalize(value).replace(/\D/g, "");
    if (digits.startsWith("0020")) digits = digits.slice(2);
    if (digits.startsWith("20") && digits.length === 12) digits = `0${digits.slice(2)}`;
    if (/^1\d{9}$/.test(digits)) digits = `0${digits}`;
    return /^01[0125]\d{8}$/.test(digits) ? digits : "";
  }

  // The customer's messages, newest first, each as its lines (customers often send name, phones and address on
  // separate lines of one message).
  function customerMessages(messages) {
    return (Array.isArray(messages) ? messages : [])
      .filter(message => message && Number(message.message_type) === 0 && !message.private && typeof message.content === "string" && message.content.trim())
      .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0))
      .slice(0, 40)
      .map(message => message.content.split(/\r?\n+/).map(line => line.replace(/\s+/g, " ").trim().slice(0, 300)).filter(Boolean));
  }

  // «الاسم: … رقم موبايل: … العنوان: …» written on one line: each labelled part on its own.
  const LABELS = [
    ["name", /^(?:الاسم بالكامل|الاسم ثلاثي|الاسم|اسمي|إسمي|اسم المستلم)$/],
    ["phone", /^(?:رقم الموبايل|رقم موبايل|رقم التليفون|رقم الهاتف|رقم الواتس|رقمي|رقم|الموبايل|موبايل|التليفون|تليفون)$/],
    ["address", /^(?:العنوان بالتفصيل|العنوان|عنواني|عنوان)$/],
    ["governorate", /^(?:المحافظه|المحافظة|محافظه|محافظة)$/],
    ["city", /^(?:المدينه|المدينة|المركز|المنطقه|المنطقة)$/]
  ];
  const LABEL_PATTERN = /(الاسم بالكامل|الاسم ثلاثي|اسم المستلم|الاسم|اسمي|إسمي|رقم الموبايل|رقم موبايل|رقم التليفون|رقم الهاتف|رقم الواتس|رقمي|الموبايل|موبايل|التليفون|تليفون|العنوان بالتفصيل|العنوان|عنواني|المحافظة|المحافظه|المدينة|المدينه|المركز|المنطقة|المنطقه)\s*[:：\-]\s*/g;
  function labelledParts(line) {
    const marks = [...line.matchAll(LABEL_PATTERN)];
    if (!marks.length) return null;
    const parts = {};
    marks.forEach((mark, index) => {
      const value = line.slice(mark.index + mark[0].length, index + 1 < marks.length ? marks[index + 1].index : line.length).replace(/[،,]\s*$/, "").trim();
      const type = LABELS.find(([, pattern]) => pattern.test(mark[1]))?.[0];
      if (type && value && !parts[type]) parts[type] = value;
    });
    return parts;
  }

  const NAME_STOP = new Set(["رقم", "موبايل", "تليفون", "العنوان", "عنوان", "محافظه", "المحافظه", "واتس", "الموبايل"]);
  function cleanName(value) {
    const words = String(value || "").replace(/[\d٠-٩+()\-:،,.]/g, " ").split(/\s+/).filter(Boolean);
    const out = [];
    for (const word of words) { if (NAME_STOP.has(normalize(word))) break; out.push(word); }
    return out.length >= 2 ? out.slice(0, 4).join(" ") : "";
  }

  // Newest first, one suggestion of each kind except books.
  function extract(messages, { books = [], knownPhone = "", rows } = {}) {
    const list = customerMessages(messages);
    const out = { phones: [], name: "", governorate: "", city: "", address: "", books: [] };
    const index = rows || bookIndex(books);
    const governorates = GOVERNORATES.map(name => ({ name, key: normalize(name).replace(/^ال/, "") }));
    const findGovernorate = plain => governorates.find(item => (` ${plain} `).includes(` ${item.key} `) || (` ${plain} `).includes(` ال${item.key} `))?.name || "";
    const seenBooks = new Set();
    const conversationGrades = [...new Set(list.flat().flatMap(gradeTokens))];
    const contextGrades = conversationGrades.length === 1 ? conversationGrades : [];
    const addPhones = text => {
      const found = [];
      for (const match of normalize(text).replace(/\s+/g, "").match(/(?:0020|20|0)?1[0125]\d{8}/g) || []) {
        const phone = normalizePhone(match);
        if (phone) found.push(phone);
        if (phone && phone !== knownPhone && !out.phones.includes(phone)) out.phones.push(phone);
      }
      return found;
    };
    for (const lines of list) {
      lines.forEach((line, position) => {
        const parts = labelledParts(line);
        const phonesHere = addPhones(line);
        if (parts) {
          if (!out.name && parts.name) out.name = cleanName(parts.name);
          if (!out.governorate && parts.governorate) out.governorate = findGovernorate(normalize(parts.governorate)) || "";
          if (!out.city && parts.city) out.city = parts.city.slice(0, 60);
          if (!out.address && parts.address && parts.address.length >= 6) out.address = parts.address;
        }
        const text = parts ? (parts.address || "") : line, plain = normalize(text);
        let governorate = findGovernorate(plain), city = "";
        for (const [alias, owner] of Object.entries(CITY_GOVERNORATE)) {
          if ((` ${plain} `).includes(` ${alias} `)) { city = alias; governorate = governorate || owner; break; }
        }
        if (!out.governorate && governorate) out.governorate = governorate;
        if (!out.city && city) out.city = text.match(new RegExp(city.split(" ").map(part => part.replace(/[ه]$/, "[هة]")).join("\\s*"), "i"))?.[0] || city;
        const words = plain.split(" ");
        if (!parts && !out.address && !phonesHere.length && text.length >= 10 && (governorate || city || ADDRESS_WORDS.some(word => words.includes(word)))) out.address = text;
        // A line of two to four words right above a phone number is most likely the name («جونير رأفت شحاته»).
        if (!out.name && !parts && /^[\p{L}\s]+$/u.test(line) && line.split(" ").length >= 2 && line.split(" ").length <= 4 && lines[position + 1] && normalizePhone(lines[position + 1]) && !governorate && !scoreBooks(line, index).length) out.name = line;
        if (parts && !parts.address) return;
        for (const { book } of scoreBooks(text, index, contextGrades).slice(0, 3)) {
          if (seenBooks.has(book.id)) continue;
          seenBooks.add(book.id);
          out.books.push(book);
        }
      });
    }
    out.books = out.books.slice(0, 8);
    return out;
  }

  return { GOVERNORATES, normalize, gradeTokens, normalizePhone, bookIndex, searchBooks, extract };
});
