const express = require("express");
const { env } = require("../config/env");
const { verifyMetaSignature } = require("../security/signatures");
const { mapMessengerWebhook } = require("../providers/messenger/messenger.mapper");

function verify(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === env.metaWebhookVerifyToken) return res.status(200).send(challenge);
  return res.sendStatus(403);
}

function messengerWebhookRouter(container) {
  const router = express.Router();
  router.get("/", verify);
  router.post("/", async (req, res, next) => {
    try {
      const signatureValid = verifyMetaSignature({
        appSecret: env.metaAppSecret,
        rawBody: req.rawBody,
        signature: req.headers["x-hub-signature-256"],
        production: env.isProduction
      });
      if (env.isProduction && !signatureValid) return res.status(401).json({ ok: false, message: "Invalid signature" });

      const mapped = mapMessengerWebhook(req.body);
      const externalEventId = mapped?.type === "message.status"
        ? `${mapped.externalMessageId || "unknown"}:${mapped.providerStatus}:${mapped.providerTimestamp?.toISOString?.() || ""}`
        : mapped?.externalMessageId || null;
      const event = await container.webhookService.persist({
        provider: "messenger",
        externalEventId,
        eventType: mapped?.type || "unknown",
        payload: req.body,
        signatureValid
      });
      if (!mapped || event.duplicate) return res.json({ ok: true, ignored: true, duplicate: Boolean(event.duplicate) });

      const resolved = await container.channelService.resolveMessengerAccount(mapped.pageId);
      if (!resolved.account) {
        await container.repository.updateWebhookEvent(event.id, { status: "ignored", processedAt: new Date(), lastError: resolved.reason || "unknown_channel_account" });
        return res.json({ ok: true, ignored: true, reason: resolved.reason || "unknown_channel_account" });
      }

      await container.repository.updateWebhookEvent(event.id, { channelAccountId: resolved.account.id, status: "processing" });
      if (mapped.type === "message.status") {
        const result = await container.messageService.applyProviderStatus({
          channelAccount: resolved.account,
          externalMessageId: mapped.externalMessageId,
          status: mapped.status,
          providerStatus: mapped.providerStatus,
          providerTimestamp: mapped.providerTimestamp,
          rawPayload: req.body
        });
        await container.repository.updateWebhookEvent(event.id, { status: result.ignored ? "ignored" : "processed", processedAt: new Date(), lastError: result.reason || null });
        return res.json({ ok: true, ...result });
      }

      await container.webhookService.processInbound({ ...mapped, channelAccount: resolved.account, payload: req.body });
      await container.repository.updateWebhookEvent(event.id, { status: "processed", processedAt: new Date() });
      res.json({ ok: true });
    } catch (error) { next(error); }
  });
  return router;
}

module.exports = { messengerWebhookRouter };
