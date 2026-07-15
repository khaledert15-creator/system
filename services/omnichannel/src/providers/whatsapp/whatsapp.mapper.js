function mapWhatsAppWebhook(payload) {
  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value || {};
  const phoneNumberId = value.metadata?.phone_number_id || value.metadata?.phoneNumberId || null;
  const status = value.statuses?.[0];
  if (status) {
    const error = status.errors?.[0] || null;
    return {
      type: "message.status",
      provider: "whatsapp",
      phoneNumberId,
      externalMessageId: status.id,
      status: mapWhatsAppStatus(status.status),
      providerStatus: status.status,
      providerTimestamp: status.timestamp ? new Date(Number(status.timestamp) * 1000) : new Date(),
      errorCode: error?.code ? String(error.code) : null,
      errorMessage: error?.message || error?.title || null,
      raw: payload
    };
  }
  const message = value.messages?.[0];
  const contact = value.contacts?.[0];
  if (!message) return null;
  const mediaType = ["image", "document", "audio", "video"].find(type => message[type]);
  const media = mediaType ? message[mediaType] : null;
  return {
    type: "message.inbound",
    provider: "whatsapp",
    phoneNumberId,
    externalIdentityId: message.from,
    phone: message.from,
    displayName: contact?.profile?.name || message.from,
    externalMessageId: message.id,
    messageType: mediaType || "text",
    text: message.text?.body || media?.caption || "",
    caption: media?.caption || null,
    media: media ? {
      mediaUrl: media.link || null,
      mediaStorageKey: media.id || null,
      mediaFilename: media.filename || `${media.id || message.id}.${media.mime_type?.split("/").pop() || "bin"}`,
      mediaMimeType: media.mime_type || null,
      mediaSize: media.file_size ? Number(media.file_size) : null,
      mediaMetadata: { providerMediaId: media.id || null, sha256: media.sha256 || null, incoming: true }
    } : {},
    providerTimestamp: message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date(),
    raw: payload
  };
}

function mapWhatsAppStatus(status) {
  if (["sent", "delivered", "read", "failed"].includes(status)) return status;
  return status === "error" ? "failed" : "sent";
}

module.exports = { mapWhatsAppWebhook, mapWhatsAppStatus };
