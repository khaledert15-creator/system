const express = require("express");
const { z } = require("zod");
const { requirePermission } = require("../middleware/permissions");

const templateSchema = z.object({
  channelAccountId: z.string().optional().nullable(),
  provider: z.string().min(1),
  templateName: z.string().min(1),
  languageCode: z.string().default("ar"),
  category: z.string().default("utility"),
  status: z.string().default("draft"),
  components: z.record(z.any()).optional(),
  variablesSchema: z.record(z.any()).optional(),
  externalTemplateId: z.string().optional().nullable(),
  isActive: z.boolean().optional()
});

function templatesRouter(container) {
  const router = express.Router();
  router.get("/message-templates", requirePermission("omni:view"), async (req, res, next) => {
    try { res.json({ ok: true, templates: await container.repository.listTemplates(req.query) }); } catch (error) { next(error); }
  });
  router.post("/message-templates", requirePermission("omnichannel.channels.update"), async (req, res, next) => {
    try {
      const body = templateSchema.parse(req.body);
      const template = await container.repository.createTemplate({
        channelAccountId: body.channelAccountId || null,
        provider: body.provider,
        templateName: body.templateName,
        languageCode: body.languageCode,
        category: body.category,
        status: body.status,
        components: body.components || {},
        variablesSchema: body.variablesSchema || {},
        externalTemplateId: body.externalTemplateId || null,
        isActive: body.isActive !== false
      });
      res.status(201).json({ ok: true, template });
    } catch (error) { next(error); }
  });
  return router;
}

module.exports = { templatesRouter };
