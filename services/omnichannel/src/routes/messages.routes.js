const express = require("express");
const { z } = require("zod");
const { requirePermission } = require("../middleware/permissions");
const { sendRateLimit } = require("../middleware/rate-limit");

const mediaSchema = z.object({
  messageType: z.string().optional(),
  mediaUrl: z.string().optional().nullable(),
  mediaStorageKey: z.string().optional().nullable(),
  mediaFilename: z.string().optional().nullable(),
  mediaMimeType: z.string().optional().nullable(),
  mediaSize: z.number().optional().nullable(),
  mediaMetadata: z.record(z.any()).optional()
}).optional();

const outboundSchema = z.object({
  text: z.string().max(4000).optional().default(""),
  messageType: z.string().optional().default("text"),
  mode: z.enum(["reply", "internal_note"]).optional().default("reply"),
  caption: z.string().max(2000).optional().nullable(),
  replyToMessageId: z.string().optional().nullable(),
  media: mediaSchema,
  templateId: z.string().optional().nullable(),
  templateVariables: z.record(z.any()).optional(),
  clientMessageId: z.string().optional()
});

function messagesRouter(container) {
  const router = express.Router();
  router.get("/conversations/:id/messages", requirePermission("omni:view"), async (req, res, next) => {
    try { res.json({ ok: true, messages: await container.messageService.list(req.params.id) }); } catch (error) { next(error); }
  });
  router.post("/conversations/:id/messages", sendRateLimit, requirePermission("omni:send"), async (req, res, next) => {
    try {
      const body = outboundSchema.parse(req.body);
      const result = await container.messageService.sendOutbound({
        conversationId: req.params.id,
        user: req.user,
        text: body.text,
        clientId: body.clientMessageId,
        messageType: body.messageType,
        mode: body.mode,
        media: body.media || {},
        caption: body.caption,
        replyToMessageId: body.replyToMessageId,
        templateId: body.templateId,
        templateVariables: body.templateVariables || {}
      });
      res.status(result.error && !result.retry ? 502 : 201).json({ ok: !(result.error && !result.retry), ...result });
    } catch (error) { next(error); }
  });
  router.post("/messages/:id/retry", sendRateLimit, requirePermission("omni:send"), async (req, res, next) => {
    try { res.json({ ok: true, ...(await container.messageService.retryMessage({ messageId: req.params.id, user: req.user, manual: true })) }); } catch (error) { next(error); }
  });
  router.post("/messages/:id/status/:status", requirePermission("omni:mock"), async (req, res, next) => {
    try { res.json({ ok: true, message: await container.messageService.simulateStatus({ messageId: req.params.id, status: req.params.status }) }); } catch (error) { next(error); }
  });
  return router;
}

module.exports = { messagesRouter };
