const { env } = require("../config/env");

class MessageRetryJob {
  constructor({ repository, messageService, workerId = `retry-${process.pid}-${Date.now()}` }) {
    this.repository = repository;
    this.messageService = messageService;
    this.workerId = workerId;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.run().catch(error => console.error(JSON.stringify({ level: "error", job: "message-retry", message: error.message }))), Number(env.retryPollMs || 10000));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  backoffMs(attempt) {
    return Math.min(15 * 60 * 1000, 1000 * Math.pow(2, Math.max(0, attempt - 1)));
  }

  async run({ limit = 5 } = {}) {
    if (this.running) return { ok: true, skipped: true };
    this.running = true;
    let processed = 0;
    try {
      for (let i = 0; i < limit; i += 1) {
        const job = await this.repository.claimNextOutboundJob({ workerId: this.workerId });
        if (!job) break;
        processed += 1;
        const message = job.message;
        const conversation = message.conversation;
        const result = await this.messageService.deliverOutbound({
          message,
          conversation,
          user: { id: message.sentByUserId || this.workerId, permissions: ["omni:admin"] },
          clientMessageId: message.clientMessageId
        });
        if (!result.error && !result.retry) {
          await this.repository.updateOutboundJob(job.id, { status: "completed", lockedAt: null, lockedBy: null, lastError: null });
        } else if (job.attemptCount >= job.maxAttempts) {
          await this.repository.updateOutboundJob(job.id, { status: "dead", lockedAt: null, lockedBy: null, lastError: result.error || "max attempts reached" });
          await this.repository.updateMessageStatus(message.id, { status: "failed" });
        } else {
          await this.repository.updateOutboundJob(job.id, {
            status: "retry",
            lockedAt: null,
            lockedBy: null,
            lastError: result.error || "retry pending",
            nextAttemptAt: new Date(Date.now() + this.backoffMs(job.attemptCount))
          });
        }
      }
      return { ok: true, processed };
    } finally {
      this.running = false;
    }
  }
}

module.exports = { MessageRetryJob };
