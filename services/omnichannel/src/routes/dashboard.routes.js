const express = require("express");
const { requirePermission } = require("../middleware/permissions");

function dashboardRouter(container) {
  const router = express.Router();
  router.get("/dashboard/summary", requirePermission("omni:view"), async (_req, res, next) => {
    try { res.json({ ok: true, summary: await container.dashboardService.summary() }); } catch (error) { next(error); }
  });
  return router;
}

module.exports = { dashboardRouter };
