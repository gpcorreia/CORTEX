import { Router } from "express";
import { createPageController } from "../controllers/page.controller.js";
import {
  protectAdminPage,
  redirectAuthenticatedAdmin,
} from "../middlewares/auth.middleware.js";

export function pageRoutes(publicDir: string) {
  const router = Router();
  const controller = createPageController(publicDir);
  router.get("/", (_req, res) => res.redirect(302, "/dashboard"));
  router.get("/login", redirectAuthenticatedAdmin, controller.login);
  router.get("/research", protectAdminPage, controller.research);
  router.get(
    ["/workflows", "/workflows/:id"],
    protectAdminPage,
    controller.workflows,
  );
  router.get("/competitors", protectAdminPage, controller.competitors);
  router.get(
    ["/dashboard", "/campaigns", "/campaigns/:id", "/expenses"],
    protectAdminPage,
    controller.cortex,
  );
  return router;
}
