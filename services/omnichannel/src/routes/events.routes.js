const express = require("express");
const { auth } = require("../middleware/auth");
const { createSseTicket, verifySseTicket } = require("../security/sse-tickets");
const { env } = require("../config/env");

function eventsRouter(container) {
  const router = express.Router();
  router.post("/ticket", auth, (req, res) => {
    res.json({ ok: true, ticket: createSseTicket(req.user), expiresInMs: env.sseTicketTtlMs });
  });
  router.get("/", (req, res) => {
    const ticket = verifySseTicket(req.query.ticket);
    if (!ticket) return res.status(401).json({ ok: false, message: "SSE ticket is required" });
    req.user = { id: ticket.sub, username: ticket.username };
    return container.sse.connect(req, res);
  });
  return router;
}

module.exports = { eventsRouter };
