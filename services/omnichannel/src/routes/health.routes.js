function healthRouter(_container) {
  throw new Error("Health routes are mounted directly in app.js");
}

module.exports = { healthRouter };
