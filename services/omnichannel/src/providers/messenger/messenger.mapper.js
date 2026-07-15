function mapMessengerWebhook(payload) {
  const entry = payload.entry?.[0];
  const pageId = entry?.id || null;
  const messaging = entry?.messaging?.[0];
  if (messaging?.delivery) {
    return {
      type: "message.status",
      provider: "messenger",
      pageId,
      externalMessageId: messaging.delivery.mids?.[0],
      status: "delivered",
      providerStatus: "delivered",
      providerTimestamp: messaging.delivery.watermark ? new Date(messaging.delivery.watermark) : new Date(),
      raw: payload
    };
  }
  if (messaging?.read) {
    return {
      type: "message.status",
      provider: "messenger",
      pageId,
      externalMessageId: messaging.read.mid || messaging.read.mids?.[0],
      status: "read",
      providerStatus: "read",
      providerTimestamp: messaging.read.watermark ? new Date(messaging.read.watermark) : new Date(),
      raw: payload
    };
  }
  if (!messaging?.message) return null;
  const attachment = messaging.message.attachments?.[0];
  const attachmentType = attachment?.type === "file" ? "document" : attachment?.type;
  return {
    type: "message.inbound",
    provider: "messenger",
    pageId,
    externalIdentityId: messaging.sender?.id,
    displayName: messaging.sender?.id,
    externalMessageId: messaging.message.mid,
    messageType: attachmentType || "text",
    text: messaging.message.text || "",
    media: attachment ? {
      mediaUrl: attachment.payload?.url || null,
      mediaStorageKey: attachment.payload?.url || null,
      mediaFilename: attachment.payload?.name || `${messaging.message.mid}.${attachmentType || "file"}`,
      mediaMimeType: attachment.payload?.mime_type || null,
      mediaSize: attachment.payload?.size ? Number(attachment.payload.size) : null,
      mediaMetadata: { incoming: true, attachmentType: attachment.type }
    } : {},
    providerTimestamp: messaging.timestamp ? new Date(messaging.timestamp) : new Date(),
    raw: payload
  };
}

module.exports = { mapMessengerWebhook };
