import { Router } from "express";
import type { Product } from "../services/research.js";
import { createMonitorController, workflowIdGuard } from "../controllers/monitor.controller.js";
import { createTranslationController } from "../controllers/translation.controller.js";

export function monitorRoutes(provider: () => Promise<Product[]>) {
  const router = Router();
  const controller = createMonitorController(provider);
  const translation = createTranslationController();
  router.get("/workflows", controller.list);
  router.use("/workflows/:id", workflowIdGuard());
  router.get("/workflows/:id", controller.get);
  router.post("/workflows/:id/start", controller.start);
  router.post("/workflows/:id/validate-media", controller.validateMedia);
  router.post("/workflows/:id/branding/retry", controller.retryBranding);
  router.post("/workflows/:id/branding/reset", controller.resetBranding);
  router.post("/workflows/:id/branding/custom-name", controller.saveCustomBrandName);
  router.post("/workflows/:id/branding/create", controller.createBrand);
  router.post("/workflows/:id/branding/choose-name", controller.chooseBrandName);
  router.post("/workflows/:id/branding/regenerate-names", controller.regenerateNames);
  router.post("/workflows/:id/branding/approve", controller.approveBrand);
  router.post("/workflows/:id/branding/review-draft", controller.reviewDraft);
  router.post("/workflows/:id/branding/retry-adaptations", controller.retryAdaptations);
  router.get("/workflows/:id/artifacts/:kind", controller.artifact);
  router.post("/workflows/:id/translation/start", translation.start);
  router.post("/workflows/:id/translation/approve", translation.approve);
  router.post("/workflows/:id/translation/collect", translation.collect);
  router.get("/workflows/:id/translation/preview/:competitor/:page", translation.preview);
  router.get("/workflows/:id/translation/assets/:asset", translation.asset);
  return router;
}
