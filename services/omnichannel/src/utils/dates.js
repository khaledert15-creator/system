function now() {
  return new Date();
}

function iso(date = new Date()) {
  return new Date(date).toISOString();
}

function startOfDay(date = new Date()) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

module.exports = { now, iso, startOfDay };
