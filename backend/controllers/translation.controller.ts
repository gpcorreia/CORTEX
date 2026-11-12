import type { RequestHandler } from "express";
import { readFile } from "node:fs/promises";
import {
  approveTranslation,
  collectMissingFunnel,
  getTranslationState,
  startTranslation,
} from "../services/siteTranslation.js";
import { workflowView } from "../services/workflowMonitor.js";
import { localProjectFile } from "../services/funnelPreview.js";

const action =
  (task: (id: string) => Promise<unknown>, status = 200): RequestHandler<any> =>
  async (req, res) => {
    try {
      await task(req.params.id);
      res.status(status).json(await workflowView(req.params.id));
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  };

export function createTranslationController() {
  return {
    start: action(startTranslation, 202),
    approve: action(approveTranslation),
    collect: action(collectMissingFunnel),
    preview: (async (req, res) => {
      try {
        const view = await workflowView(req.params.id);
        const state = await getTranslationState(req.params.id);
        const page = state?.pages.find(
          (item) =>
            String(item.competitor) === req.params.competitor &&
            item.page === req.params.page,
        );
        if (
          !view?.projectPath ||
          !page ||
          !["awaiting_review", "completed"].includes(state!.status) ||
          view.translation.stale
        )
          throw Error("Pré-visualização indisponível.");
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox",
        );
        res.setHeader("X-Content-Type-Options", "nosniff");
        res
          .type("html")
          .send(
            await readFile(
              localProjectFile(view.projectPath, page.output),
              "utf8",
            ),
          );
      } catch {
        res.status(404).json({ error: "Pré-visualização indisponível." });
      }
    }) as RequestHandler<any>,
    asset: (async (req, res) => {
      try {
        const view = await workflowView(req.params.id);
        const state = await getTranslationState(req.params.id);
        const file = state?.assets[req.params.asset];
        if (
          !view?.projectPath ||
          !file ||
          !/^[a-f0-9]{24}$/.test(req.params.asset)
        )
          throw Error("Imagem indisponível.");
        res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.sendFile(localProjectFile(view.projectPath, file));
      } catch {
        res.status(404).end();
      }
    }) as RequestHandler<any>,
  };
}

