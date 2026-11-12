import { Router } from "express";
import type { Product } from "../services/research.js";
import { createWorkflowController, workflowIdGuard } from "../controllers/workflow.controller.js";

export function workflowRoutes(provider: () => Promise<Product[]>) {
  const router = Router();
  const controller = createWorkflowController(provider);
  router.use("/workflow/:id", workflowIdGuard());
  router.get("/workflow/:id", controller.get);
  router.post("/workflow/:id/download", controller.download);
  router.post("/workflow/:id/approve", controller.approve);
  return router;
}
