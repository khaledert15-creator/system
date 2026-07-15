class NotificationService {
  constructor({ sse }) {
    this.sse = sse;
  }

  conversationUpdated(data) {
    this.sse.publish("conversation.updated", data);
    this.sse.publish("notification", { type: "conversation", ...data });
  }

  messageCreated(data) {
    this.sse.publish("message.created", data);
  }
}

module.exports = { NotificationService };
