class SseManager {
  constructor() {
    this.clients = new Map();
  }

  connect(req, res) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ id })}\n\n`);
    this.clients.set(id, res);
    req.on("close", () => this.clients.delete(id));
    return id;
  }

  publish(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [id, res] of this.clients.entries()) {
      try {
        res.write(payload);
      } catch {
        this.clients.delete(id);
      }
    }
  }

  count() {
    return this.clients.size;
  }
}

module.exports = { SseManager };
