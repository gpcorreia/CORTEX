import express from "express";
import { config } from "./config.js";
import { loadResearch, type Product } from "./services/research.js";
import { apiRoutes } from "./routes/api.routes.js";
import { pageRoutes } from "./routes/page.routes.js";
import { workflowRoutes } from "./routes/workflow.routes.js";
import { monitorRoutes } from "./routes/monitor.routes.js";
import { protectAdmin, protectAdminPage } from "./middlewares/auth.middleware.js";
import { requireSameOrigin } from "./middlewares/security.middleware.js";

export function createApp(
  settings = config,
  provider: () => Promise<Product[]> = () => loadResearch(settings.sheetUrl),
) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(requireSameOrigin);
  app.use(express.json({ limit: "8mb" }));
  app.use("/api", apiRoutes(settings, provider));
  app.use("/api", protectAdmin, workflowRoutes(provider));
  app.use("/api", protectAdmin, monitorRoutes(provider));
  app.use(pageRoutes(settings.publicDir));
  app.use((req, res, next) => {
    if (req.path.toLowerCase().endsWith(".html")) {
      protectAdminPage(req, res, next);
      return;
    }
    next();
  });
  app.use(express.static(settings.publicDir));
  app.use((_req, res) =>
    res.status(404).json({ error: "Página não encontrada." }),
  );
  app.use(
    (
      error: Error & { status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => res.status(error.status ?? 502).json({ error: error.message }),
  );
  return app;
}
