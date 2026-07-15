const express = require("express");
const { requirePermission } = require("../middleware/permissions");

function assignmentsRouter(container) {
  const router = express.Router();
  router.post("/conversations/:id/claim", requirePermission("omni:assign"), async (req, res, next) => {
    try {
      const conversation = await container.conversationService.claim({ conversationId: req.params.id, user: req.user, expectedVersion: req.body?.version });
      res.json({ ok: true, conversation });
    } catch (error) { next(error); }
  });
  router.post("/conversations/:id/assign", requirePermission("omni:assign"), async (req, res, next) => {
    try {
      const conversation = await container.conversationService.assign({ conversationId: req.params.id, user: req.user, toUserId: req.body.toUserId, reason: req.body.reason, expectedVersion: req.body?.version });
      res.json({ ok: true, conversation });
    } catch (error) { next(error); }
  });
  return router;
}

module.exports = { assignmentsRouter };
