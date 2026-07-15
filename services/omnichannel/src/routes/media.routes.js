const express = require("express");
const { z } = require("zod");
const { requirePermission } = require("../middleware/permissions");
const { uploadRateLimit } = require("../middleware/rate-limit");

const uploadSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(3).max(200),
  dataBase64: z.string().min(1)
});

function mediaRouter(container) {
  const router = express.Router();
  router.post("/media/upload", uploadRateLimit, requirePermission("omni:send"), async (req, res, next) => {
    try {
      const media = await container.mediaService.saveBase64(uploadSchema.parse(req.body));
      res.status(201).json({ ok: true, media });
    } catch (error) { next(error); }
  });
  router.get("/media/*", requirePermission("omni:view"), async (req, res, next) => {
    try {
      const key = decodeURIComponent(req.params[0] || "");
      const buffer = await container.storage.get(key);
      res.setHeader("Content-Type", "application/octet-stream");
      res.send(buffer);
    } catch (error) { next(error); }
  });
  return router;
}

module.exports = { mediaRouter };
