import { Router } from "express";
import multer from "multer";
import type { config } from "../config.js";
import type { Product } from "../services/research.js";
import { ProductResearchController } from "../controllers/productResearch.controller.js";
import { getOrdersfromShopify } from "../controllers/orders.controller.js";
import { getCommerce } from "../controllers/commerce.controller.js";
import { handleCampaignCreation, handleCampaignDeactivation, handleCampaingDailyStatus } from "../controllers/campaign.controller.js";
import { getProducts, handleProductCreation } from "../controllers/product.controllers.js";
import { handleExpenseCreation, handleGetAllExpenses } from "../controllers/expense.controller.js";
import { handleSignup, handleLogin, handleLogout } from "../controllers/auth.controller.js";
import { protectAdmin } from "../middlewares/auth.middleware.js";

// settings/provider stay in the signature because createApp supplies the same
// API-route factory dependencies used by the existing application routes.
export function apiRoutes(
  _settings: typeof config,
  _provider: () => Promise<Product[]>,
) {

  const router = Router();
  const upload = multer({ dest: "tmp/product-uploads" });
  const controller = new ProductResearchController(_settings, _provider);
 
  // User Authentication
  router.post("/signup", handleSignup);
  router.post("/login", handleLogin);
  router.post("/logout", handleLogout);
  router.use(protectAdmin);


  router.get("/status", controller.getStatus);
  router.get("/commerce", getCommerce);
  router.get("/research", controller.getResearch);
  router.get("/inputs/:id", controller.getInputs);
  router.post("/inputs/:id", controller.saveInputs);
  router.get("/shopify/orders", getOrdersfromShopify);

  // Products
  router.get("/products", getProducts);
  router.post("/products", upload.single("image"), handleProductCreation);

  // Campaigns
  router.post("/campaigns/create", handleCampaignCreation);
  router.patch("/campaigns/:id/deactivate", handleCampaignDeactivation);
  router.post("/campaigns/dailystatus", handleCampaingDailyStatus);
  
  // Expenses
  router.post("/expenses", handleExpenseCreation);
  router.get("/expenses/getall", handleGetAllExpenses);


  return router;
}
