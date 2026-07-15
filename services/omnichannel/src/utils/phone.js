function normalizePhone(value = "") {
  let phone = String(value || "").trim();
  phone = phone.replace(/[^\d+]/g, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  if (phone.startsWith("01") && phone.length === 11) phone = `+20${phone.slice(1)}`;
  if (phone.startsWith("20") && phone.length === 12) phone = `+${phone}`;
  return phone;
}

function phoneSearchVariants(value = "") {
  const normalized = normalizePhone(value);
  const digits = normalized.replace(/\D/g, "");
  const variants = new Set([String(value || "").trim(), normalized, digits]);
  if (digits.startsWith("20")) variants.add(`0${digits.slice(2)}`);
  if (digits.startsWith("2")) variants.add(`0${digits.slice(1)}`);
  return [...variants].filter(Boolean);
}

module.exports = { normalizePhone, phoneSearchVariants };
