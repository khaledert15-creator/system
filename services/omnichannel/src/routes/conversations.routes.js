const express = require("express");
const { requirePermission } = require("../middleware/permissions");

function conversationsRouter(container) {
  const router = express.Router();
  router.get("/conversations", requirePermission("omni:view"), async (req, res, next) => {
    try { res.json({ ok: true, conversations: await container.conversationService.list(req.query) }); } catch (error) { next(error); }
  });
  router.get("/conversations/:id", requirePermission("omni:view"), async (req, res, next) => {
    try { res.json({ ok: true, conversation: await container.conversationService.get(req.params.id) }); } catch (error) { next(error); }
  });
  router.post("/conversations/:id/close", requirePermission("omni:assign"), async (req, res, next) => {
    try { res.json({ ok: true, conversation: await container.conversationService.setStatus({ conversationId: req.params.id, user: req.user, status: "closed", action: "closed" }) }); } catch (error) { next(error); }
  });
  router.post("/conversations/:id/reopen", requirePermission("omni:assign"), async (req, res, next) => {
    try { res.json({ ok: true, conversation: await container.conversationService.setStatus({ conversationId: req.params.id, user: req.user, status: "waiting_agent", action: "reopened" }) }); } catch (error) { next(error); }
  });
  router.post("/conversations/:id/release", requirePermission("omni:assign"), async (req, res, next) => {
    try { res.json({ ok: true, conversation: await container.conversationService.setStatus({ conversationId: req.params.id, user: req.user, status: "unassigned", action: "release" }) }); } catch (error) { next(error); }
  });
  return router;
}

module.exports = { conversationsRouter };
