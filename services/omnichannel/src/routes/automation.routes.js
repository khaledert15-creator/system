const express = require("express");
const { z } = require("zod");
const { requireAnyPermission } = require("../middleware/permissions");

const ruleSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(1000).optional().nullable(),
  isActive: z.boolean().optional(),
  triggerType: z.string().min(1).max(80),
  priority: z.number().int().optional(),
  channelScope: z.string().max(80).optional(),
  channelAccountId: z.string().optional().nullable(),
  conditions: z.record(z.any()).optional(),
  actions: z.array(z.record(z.any())).optional(),
  stopProcessing: z.boolean().optional(),
  cooldownSeconds: z.number().int().min(0).optional()
});

const businessHoursSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(160).optional(),
  timezone: z.string().max(80).optional(),
  schedule: z.record(z.any()).optional(),
  isActive: z.boolean().optional()
});

function automationRouter(container) {
  const router = express.Router();
  const canView = requireAnyPermission(["omni:view", "omni:admin"]);
  const canEdit = requireAnyPermission(["omni:admin"]);

  router.get("/automation/rules", canView, async (req, res, next) => {
    try { res.json({ ok: true, rules: await container.automationService.listRules({ triggerType: req.query.triggerType || undefined }) }); } catch (error) { next(error); }
  });

  router.get("/automation/rules/:id", canView, async (req, res, next) => {
    try { res.json({ ok: true, rule: await container.automationService.getRule(req.params.id) }); } catch (error) { next(error); }
  });

  router.post("/automation/rules", canEdit, async (req, res, next) => {
    try { res.status(201).json({ ok: true, rule: await container.automationService.createRule(ruleSchema.parse(req.body), req.user) }); } catch (error) { next(error); }
  });

  router.patch("/automation/rules/:id", canEdit, async (req, res, next) => {
    try { res.json({ ok: true, rule: await container.automationService.updateRule(req.params.id, ruleSchema.partial().parse(req.body), req.user) }); } catch (error) { next(error); }
  });

  router.delete("/automation/rules/:id", canEdit, async (req, res, next) => {
    try { res.json({ ok: true, rule: await container.automationService.deleteRule(req.params.id, req.user) }); } catch (error) { next(error); }
  });

  router.post("/automation/rules/:id/duplicate", canEdit, async (req, res, next) => {
    try {
      const existing = await container.automationService.getRule(req.params.id);
      const rule = await container.automationService.createRule({ ...existing, name: `${existing.name} Copy`, isActive: false }, req.user);
      res.status(201).json({ ok: true, rule });
    } catch (error) { next(error); }
  });

  router.post("/automation/test", canView, async (req, res, next) => {
    try { res.json({ ok: true, result: await container.automationService.testRule(req.body || {}) }); } catch (error) { next(error); }
  });

  router.post("/automation/seed-defaults", canEdit, async (req, res, next) => {
    try { res.json({ ok: true, result: await container.automationService.seedDefaults(req.user) }); } catch (error) { next(error); }
  });

  router.get("/business-hours", canView, async (_req, res, next) => {
    try { res.json({ ok: true, businessHours: await container.automationService.listBusinessHours() }); } catch (error) { next(error); }
  });

  router.post("/business-hours", canEdit, async (req, res, next) => {
    try { res.status(201).json({ ok: true, businessHours: await container.automationService.saveBusinessHours(businessHoursSchema.parse(req.body)) }); } catch (error) { next(error); }
  });

  return router;
}

module.exports = { automationRouter };
