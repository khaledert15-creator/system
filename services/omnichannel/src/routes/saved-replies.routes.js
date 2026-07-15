const express = require("express");
const { z } = require("zod");
const { requireAnyPermission } = require("../middleware/permissions");

const savedReplySchema = z.object({
  title: z.string().min(1).max(120),
  shortcut: z.string().min(1).max(80),
  content: z.string().min(1).max(4000),
  scope: z.enum(["personal", "team", "global"]).optional(),
  teamKey: z.string().max(80).optional().nullable(),
  category: z.string().max(80).optional().nullable(),
  channelType: z.string().max(40).optional().nullable(),
  isActive: z.boolean().optional()
});

function savedRepliesRouter(container) {
  const router = express.Router();
  const canView = requireAnyPermission(["omni:view", "omnichannel.saved_replies.view"]);
  const canEdit = requireAnyPermission(["omni:send", "omni:admin", "omnichannel.saved_replies.update"]);

  router.get("/saved-replies/search", canView, async (req, res, next) => {
    try {
      const replies = await container.savedReplyService.list({ user: req.user, q: req.query.q || "", channelType: req.query.channelType || undefined });
      res.json({ ok: true, replies });
    } catch (error) { next(error); }
  });

  router.get("/saved-replies", canView, async (req, res, next) => {
    try {
      const replies = await container.savedReplyService.list({
        user: req.user,
        q: req.query.q || "",
        scope: req.query.scope || undefined,
        channelType: req.query.channelType || undefined,
        includeInactive: req.query.includeInactive === "true"
      });
      res.json({ ok: true, replies });
    } catch (error) { next(error); }
  });

  router.get("/saved-replies/:id", canView, async (req, res, next) => {
    try { res.json({ ok: true, reply: await container.savedReplyService.get(req.params.id, req.user) }); } catch (error) { next(error); }
  });

  router.post("/saved-replies", canEdit, async (req, res, next) => {
    try { res.status(201).json({ ok: true, reply: await container.savedReplyService.create(savedReplySchema.parse(req.body), req.user) }); } catch (error) { next(error); }
  });

  router.patch("/saved-replies/:id", canEdit, async (req, res, next) => {
    try { res.json({ ok: true, reply: await container.savedReplyService.update(req.params.id, savedReplySchema.partial().parse(req.body), req.user) }); } catch (error) { next(error); }
  });

  router.delete("/saved-replies/:id", canEdit, async (req, res, next) => {
    try { res.json({ ok: true, reply: await container.savedReplyService.delete(req.params.id, req.user) }); } catch (error) { next(error); }
  });

  router.post("/saved-replies/:id/use", canView, async (req, res, next) => {
    try {
      const conversation = req.body?.conversationId ? await container.conversationService.get(req.body.conversationId) : null;
      res.json({ ok: true, reply: await container.savedReplyService.use(req.params.id, { user: req.user, conversation }) });
    } catch (error) { next(error); }
  });

  router.post("/saved-replies/preview", canView, async (req, res, next) => {
    try {
      const conversation = req.body?.conversationId ? await container.conversationService.get(req.body.conversationId) : null;
      res.json({ ok: true, content: container.savedReplyService.preview(req.body?.content || "", { user: req.user, conversation }) });
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = { savedRepliesRouter };
