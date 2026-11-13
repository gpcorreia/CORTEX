import { Router } from "express";
import { createPageController } from "../controllers/page.controller.js";

export function pageRoutes(publicDir: string) {
  const router = Router();
  const controller = createPageController(publicDir);
  router.get("/login", controller.login);
  router.get(["/workflows", "/workflows/:id"], controller.workflows);
  router.get("/competitors", controller.competitors);
  router.get(["/dashboard", "/campaigns", "/campaigns/:id", "/expenses"], controller.cortex);
  return router;
}
