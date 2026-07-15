const express = require("express");
const { z } = require("zod");
const { requirePermission } = require("../middleware/permissions");

const mediaSchema = z.object({ messageType: z.string().optional(), mediaUrl: z.string().optional(), mediaStorageKey: z.string().optional(), mediaFilename: z.string().optional(), mediaMimeType: z.string().optional(), mediaSize: z.number().optional(), mediaMetadata: z.record(z.any()).optional() }).optional();
const whatsappSchema = z.object({ channelAccountId: z.string(), phone: z.string().min(3), name: z.string().optional(), text: z.string().optional().default(""), messageType: z.string().optional().default("text"), media: mediaSchema });
const messengerSchema = z.object({ channelAccountId: z.string(), psid: z.string().min(3), name: z.string().optional(), text: z.string().optional().default(""), messageType: z.string().optional().default("text"), media: mediaSchema });

function mockRouter(container) {
  const router = express.Router();
  router.post("/whatsapp/incoming", requirePermission("omni:mock"), async (req, res, next) => {
    try {
      const body = whatsappSchema.parse(req.body);
      const channelAccount = await container.repository.findChannelAccount(body.channelAccountId);
      const result = await container.webhookService.processInbound({
        provider: "whatsapp",
        channelAccount,
        externalIdentityId: body.phone,
        phone: body.phone,
        displayName: body.name,
        externalMessageId: `mock-wa-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        text: body.text,
        messageType: body.messageType,
        media: body.media || {},
        caption: body.media?.caption || null,
        payload: { mock: true, body }
      });
      res.status(201).json({ ok: true, ...result });
    } catch (error) { next(error); }
  });
  router.post("/messenger/incoming", requirePermission("omni:mock"), async (req, res, next) => {
    try {
      const body = messengerSchema.parse(req.body);
      const channelAccount = await container.repository.findChannelAccount(body.channelAccountId);
      const result = await container.webhookService.processInbound({
        provider: "messenger",
        channelAccount,
        externalIdentityId: body.psid,
        displayName: body.name || body.psid,
        externalMessageId: `mock-msgr-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        text: body.text,
        messageType: body.messageType,
        media: body.media || {},
        payload: { mock: true, body }
      });
      res.status(201).json({ ok: true, ...result });
    } catch (error) { next(error); }
  });
  return router;
}

module.exports = { mockRouter };
