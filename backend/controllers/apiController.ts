import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { competitorsFromProducts, type Product } from "../services/research.js";
import { readInputs, saveInputs, validateInputs } from "../services/inputs.js";
import { getMediaJob } from "../services/mediaJobs.js";
import { isBrandBusy } from "../services/branding.js";

type ControllerRequest = Request<any>;
const WORKFLOW_ID = /^[a-f0-9]{24}$/;

export class ApiController {
  private readonly startedAt = new Date().toISOString();

  constructor(private readonly settings: typeof config, private readonly products: () => Promise<Product[]>) {}

  getStatus = (_req: ControllerRequest, res: Response) => {
    res.json({ app: "ecomm-workspace", inputSchema: 4, maxCompetitors: 3, mediaMode: "download-review-only", pid: process.pid, startedAt: this.startedAt, dataDir: this.settings.dataDir, publicDir: this.settings.publicDir, inputFields: ["competitors", "productImage", "createBrand", "sameProduct", "locale", "currency"] });
  };

  getResearch = async (_req: ControllerRequest, res: Response, next: NextFunction) => {
    try {
      const products = await this.products();
      res.json({ products, competitors: competitorsFromProducts(products), syncedAt: new Date().toISOString() });
    } catch (error) { next(error); }
  };

  getInputs = async (req: ControllerRequest, res: Response, next: NextFunction) => {
    try {
      const workflowId = String(req.params.id);
      if (!WORKFLOW_ID.test(workflowId)) { res.status(400).json({ error: "Identificador inválido." }); return; }
      res.json(await readInputs(this.settings.dataDir, workflowId));
    } catch (error) { next(error); }
  };

  saveInputs = async (req: ControllerRequest, res: Response, next: NextFunction) => {
    try {
      const workflowId = String(req.params.id);
      if (WORKFLOW_ID.test(workflowId) && ((await getMediaJob(workflowId))?.status === "running" || isBrandBusy(workflowId))) { res.status(409).json({ error: "Brand & Media está em execução. Aguarda antes de alterar os inputs." }); return; }
      const product = (await this.products()).find((item) => item.id === workflowId);
      if (!product?.approved) { res.status(403).json({ error: "O produto não está aprovado pelo coach. Atualiza a lista." }); return; }
      try { res.json(await saveInputs(this.settings.dataDir, product.id, validateInputs(req.body), product.name)); }
      catch (error) { res.status(400).json({ error: (error as Error).message }); }
    } catch (error) { next(error); }
  };
}
