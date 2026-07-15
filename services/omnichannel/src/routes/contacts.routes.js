const express = require("express");
const { requirePermission } = require("../middleware/permissions");

function contactsRouter(container) {
  const router = express.Router();
  router.get("/contacts/lookup", requirePermission("omni:view"), (req, res, next) => {
    try { res.json({ ok: true, ...container.customerLookup.findByPhone(req.query.phone || "") }); } catch (error) { next(error); }
  });
  return router;
}

module.exports = { contactsRouter };
