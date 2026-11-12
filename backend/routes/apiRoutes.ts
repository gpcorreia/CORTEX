import { Router } from "express";
import multer from "multer";
import type { config } from "../config.js";
import type { Product } from "../services/research.js";
import { ApiController } from "../controllers/apiController.js";
import { getOrdersfromShopify } from "../controllers/orders.controller.js";
import { getCommerce } from "../controllers/commerce.controller.js";
import { handleCampaignCreation, handleCampaignDeactivation, handleCampaingDailyStatus } from "../controllers/campaign.controller.js";
import { getProducts, handleProductCreation } from "../controllers/product.controllers.js";
import { handleExpenseCreation, handleGetAllExpenses } from "../controllers/expense.controller.js";

// settings/provider stay in the signature because createApp supplies the same
// API-route factory dependencies used by the existing application routes.
export function apiRoutes(
  _settings: typeof config,
  _provider: () => Promise<Product[]>,
) {

  const router = Router();
  const upload = multer({ dest: "tmp/product-uploads" });
  const controller = new ApiController(_settings, _provider);
 
  router.get("/status", controller.getStatus);
  router.get("/commerce", getCommerce);
  router.get("/research", controller.getResearch);
  router.get("/inputs/:id", controller.getInputs);
  router.post("/inputs/:id", controller.saveInputs);
  router.get("/shopify/orders", getOrdersfromShopify);
  router.get("/products", getProducts);
  router.post("/products", upload.single("image"), handleProductCreation);
  router.post("/campaigns/create", handleCampaignCreation);
  router.patch("/campaigns/:id/deactivate", handleCampaignDeactivation);
  router.post("/campaigns/dailystatus", handleCampaingDailyStatus);
  router.post("/expenses", handleExpenseCreation);
  router.get("/expenses/getall", handleGetAllExpenses);


  return router;
}
