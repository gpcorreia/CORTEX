import type { RequestHandler } from "express";
import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  listWorkflows,
  workflowView,
  startWorkflow,
  validateWorkflowMedia,
} from "../services/workflowMonitor.js";
import {
  approveBrand,
  prepareBrand,
  chooseBrandName,
  reviewBrandDraft,
  saveCustomBrandName,
  createBrandFromChosenName,
  resetBranding,
  safeFile,
} from "../services/branding.js";
import type { Product } from "../services/research.js";

type Handler = (id: string) => Promise<unknown>;

export function workflowIdGuard(): RequestHandler {
  return (req, res, next) => {
    if (!/^[a-f0-9]{24}$/.test(String(req.params.id))) {
      res.status(400).json({ error: "Identificador inválido." });
      return;
    }
    next();
  };
}

export function createMonitorController(provider: () => Promise<Product[]>) {
  const refresh =
    (task: Handler, status = 202): RequestHandler<any> =>
    async (req, res) => {
      try {
        await task(req.params.id);
        res.status(status).json(await workflowView(req.params.id));
      } catch (error) {
        res.status(409).json({ error: (error as Error).message });
      }
    };

  return {
    list: (async (_req, res, next) => {
      try {
        res.json({ workflows: await listWorkflows() });
      } catch (error) {
        next(error);
      }
    }) as RequestHandler<any>,
    get: (async (req, res, next) => {
      try {
        const view = await workflowView(req.params.id);
        if (!view) {
          res.status(404).json({ error: "Workflow não encontrado." });
          return;
        }
        res.json(view);
      } catch (error) {
        next(error);
      }
    }) as RequestHandler<any>,
    start: (async (req, res) => {
      try {
        const product = (await provider()).find(
          (item) => item.id === req.params.id,
        );
        if (!product?.approved) {
          res.status(403).json({
            error: "O produto precisa de aprovação do coach.",
          });
          return;
        }
        res
          .status(202)
          .json(await startWorkflow(req.params.id, product.name));
      } catch (error) {
        res.status(409).json({ error: (error as Error).message });
      }
    }) as RequestHandler<any>,
    validateMedia: (async (req, res) => {
      try {
        res.status(202).json(
          await validateWorkflowMedia(
            req.params.id,
            undefined,
            undefined,
            req.body?.brandName,
          ),
        );
      } catch (error) {
        res.status(409).json({ error: (error as Error).message });
      }
    }) as RequestHandler<any>,
    retryBranding: refresh((id) => prepareBrand(id)),
    resetBranding: refresh((id) => resetBranding(id), 200),
    saveCustomBrandName: (async (req, res) => {
      try {
        await saveCustomBrandName(req.params.id, req.body?.brandName);
        res.json(await workflowView(req.params.id));
      } catch (error) {
        res.status(409).json({ error: (error as Error).message });
      }
    }) as RequestHandler<any>,
    createBrand: (async (req, res) => {
      try {
        await createBrandFromChosenName(
          req.params.id,
          undefined,
          undefined,
          req.body?.quantities,
        );
        res.status(202).json(await workflowView(req.params.id));
      } catch (error) {
        res.status(409).json({ error: (error as Error).message });
      }
    }) as RequestHandler<any>,
    chooseBrandName: (async (req, res) => {
      try {
        await chooseBrandName(req.params.id, req.body?.optionId);
        res.status(202).json(await workflowView(req.params.id));
      } catch (error) {
        res.status(409).json({ error: (error as Error).message });
      }
    }) as RequestHandler<any>,
    regenerateNames: refresh((id) =>
      prepareBrand(id, undefined, undefined, true),
    ),
    approveBrand: (async (req, res) => {
      try {
        await approveBrand(req.params.id, req.body?.quantities);
        res.status(202).json(await workflowView(req.params.id));
      } catch (error) {
        res.status(409).json({ error: (error as Error).message });
      }
    }) as RequestHandler<any>,
    reviewDraft: refresh((id) => reviewBrandDraft(id), 200),
    retryAdaptations: (async (req, res) => {
      try {
        const view = await workflowView(req.params.id);
        await approveBrand(
          req.params.id,
          view?.brand?.bundleQuantities,
          undefined,
          undefined,
          true,
        );
        res.status(202).json(await workflowView(req.params.id));
      } catch (error) {
        res.status(409).json({ error: (error as Error).message });
      }
    }) as RequestHandler<any>,
    artifact: (async (req, res) => {
      try {
        const view = await workflowView(req.params.id);
        if (!view?.projectPath || !view.brand)
          throw Error("Artefacto indisponível.");
        const file =
          req.params.kind === "logo"
            ? view.brand.logo
            : req.params.kind === "master"
              ? view.brand.master
              : view.brand.bundles.find(
                  (bundle) => `pack-${bundle.quantity}` === req.params.kind,
                )?.path;
        if (!file) throw Error("Artefacto indisponível.");
        const full = safeFile(view.projectPath, file);
        await readFile(full);
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
        );
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.sendFile(path.resolve(full));
      } catch {
        res.status(404).json({ error: "Artefacto indisponível." });
      }
    }) as RequestHandler<any>,
  };
}
