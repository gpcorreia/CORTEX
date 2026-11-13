import express from "express";
import { config } from "./config.js";
import { loadResearch, type Product } from "./services/research.js";
import { apiRoutes } from "./routes/api.routes.js";
import { pageRoutes } from "./routes/page.routes.js";
import { workflowRoutes } from "./routes/workflow.routes.js";
import { monitorRoutes } from "./routes/monitor.routes.js";

export function createApp(
  settings = config,
  provider: () => Promise<Product[]> = () => loadResearch(settings.sheetUrl),
) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);
        const forwardedHost = String(req.headers["x-forwarded-host"] ?? "")
          .split(",")[0]
          .trim();
        const requestHost = forwardedHost || req.headers.host;
        if (!requestHost || origin.host !== requestHost) {
          res.status(403).json({ error: "Origem não autorizada." });
          return;
        }
      } catch {
        res.status(403).json({ error: "Origem não autorizada." });
        return;
      }
    }
    next();
  });
  app.use(express.json({ limit: "8mb" }));
  app.use("/api", apiRoutes(settings, provider));


  
  app.use("/api", workflowRoutes(provider));
  app.use("/api", monitorRoutes(provider));
  app.use(pageRoutes(settings.publicDir));
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
