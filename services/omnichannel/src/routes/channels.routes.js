const express = require("express");
const { z } = require("zod");
const { requirePermission, requireAnyPermission } = require("../middleware/permissions");
const { makeRateLimit } = require("../middleware/rate-limit");

const accountSchema = z.object({
  channelKey: z.enum(["whatsapp", "messenger"]).optional(),
  channel: z.enum(["whatsapp", "messenger"]).optional(),
  type: z.enum(["whatsapp", "messenger"]).optional(),
  name: z.string().min(1).max(120).optional(),
  phoneNumber: z.string().max(50).optional().nullable(),
  externalPhoneNumber: z.string().max(50).optional().nullable(),
  phoneNumberId: z.string().max(120).optional().nullable(),
  wabaId: z.string().max(120).optional().nullable(),
  businessAccountId: z.string().max(120).optional().nullable(),
  pageId: z.string().max(120).optional().nullable(),
  externalAccountId: z.string().max(120).optional().nullable(),
  graphApiVersion: z.string().max(20).optional().nullable(),
  credentialMode: z.string().max(40).optional().nullable(),
  connectionMode: z.string().max(40).optional().nullable(),
  credentialsReference: z.string().max(200).optional().nullable(),
  accessToken: z.string().max(2000).optional().nullable(),
  status: z.string().max(40).optional(),
  connectionStatus: z.string().max(40).optional(),
  isActive: z.boolean().optional(),
  isCritical: z.boolean().optional(),
  configuration: z.record(z.any()).optional()
});

function channelsRouter(container) {
  const router = express.Router();
  const channelWriteLimit = makeRateLimit({ name: "channel-write", max: 80 });
  router.get("/channels", requireAnyPermission(["omni:view", "omnichannel.channels.view"]), async (_req, res, next) => {
    try { res.json({ ok: true, channels: await container.channelService.channels() }); } catch (error) { next(error); }
  });
  router.get("/channel-accounts", requireAnyPermission(["omni:view", "omnichannel.channels.view"]), async (_req, res, next) => {
    try { res.json({ ok: true, accounts: await container.channelService.accounts() }); } catch (error) { next(error); }
  });
  router.get("/channel-accounts/:id", requireAnyPermission(["omni:view", "omnichannel.channels.view"]), async (req, res, next) => {
    try { res.json({ ok: true, account: await container.channelService.account(req.params.id) }); } catch (error) { next(error); }
  });
  router.post("/channel-accounts", channelWriteLimit, requirePermission("omnichannel.channels.create"), async (req, res, next) => {
    try {
      const body = accountSchema.extend({ name: z.string().min(1).max(120) }).parse(req.body);
      res.status(201).json({ ok: true, account: await container.channelService.create(body, req.user) });
    } catch (error) { next(error); }
  });
  router.patch("/channel-accounts/:id", channelWriteLimit, requirePermission("omnichannel.channels.update"), async (req, res, next) => {
    try { res.json({ ok: true, account: await container.channelService.update(req.params.id, accountSchema.parse(req.body), req.user) }); } catch (error) { next(error); }
  });
  router.post("/channel-accounts/:id/activate", channelWriteLimit, requirePermission("omnichannel.channels.activate"), async (req, res, next) => {
    try { res.json({ ok: true, account: await container.channelService.activate(req.params.id, req.user) }); } catch (error) { next(error); }
  });
  router.post("/channel-accounts/:id/deactivate", channelWriteLimit, requirePermission("omnichannel.channels.activate"), async (req, res, next) => {
    try { res.json({ ok: true, account: await container.channelService.deactivate(req.params.id, req.user) }); } catch (error) { next(error); }
  });
  router.delete("/channel-accounts/:id", channelWriteLimit, requirePermission("omnichannel.channels.delete"), async (req, res, next) => {
    try { res.json({ ok: true, account: await container.channelService.softDelete(req.params.id, req.user) }); } catch (error) { next(error); }
  });
  router.post("/channel-accounts/:id/test-connection", channelWriteLimit, requirePermission("omnichannel.channels.test"), async (req, res, next) => {
    try { res.json({ ok: true, result: await container.channelService.testConnection(req.params.id, req.user) }); } catch (error) { next(error); }
  });
  router.get("/channel-accounts/:id/connection-status", requireAnyPermission(["omni:view", "omnichannel.channels.view"]), async (req, res, next) => {
    try { res.json({ ok: true, connection: await container.channelService.connectionStatus(req.params.id) }); } catch (error) { next(error); }
  });
  return router;
}

module.exports = { channelsRouter };
