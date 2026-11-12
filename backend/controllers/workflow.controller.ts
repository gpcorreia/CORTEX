import type { RequestHandler } from "express";
import { getMediaJob, startDownload, approveMedia } from "../services/mediaJobs.js";
import type { Product } from "../services/research.js";
import { isBrandBusy } from "../services/branding.js";

export function workflowIdGuard(): RequestHandler { return (req, res, next) => { if (!/^[a-f0-9]{24}$/.test(String(req.params.id))) { res.status(400).json({ error: "Identificador inválido." }); return; } next(); }; }
export function createWorkflowController(provider: () => Promise<Product[]>) {
  return {
    get: async (req: Parameters<RequestHandler<any>>[0], res: Parameters<RequestHandler<any>>[1], next: Parameters<RequestHandler<any>>[2]) => { try { res.json(await getMediaJob(req.params.id)); } catch (error) { next(error); } },
    download: async (req: Parameters<RequestHandler<any>>[0], res: Parameters<RequestHandler<any>>[1], next: Parameters<RequestHandler<any>>[2]) => { try { const product = (await provider()).find((item) => item.id === req.params.id); if (!product?.approved) { res.status(403).json({ error: "O produto precisa da aprovação do coach." }); return; } try { if (isBrandBusy(req.params.id)) throw Error("Aguarda pelo fim da tarefa de branding antes de voltar a descarregar."); res.status(202).json(await startDownload(req.params.id, undefined, undefined, product.name, req.body?.rescan === true)); } catch (error) { res.status(409).json({ error: (error as Error).message }); } } catch (error) { next(error); } },
    approve: async (req: Parameters<RequestHandler<any>>[0], res: Parameters<RequestHandler<any>>[1]) => { try { res.json(await approveMedia(req.params.id)); } catch (error) { res.status(409).json({ error: (error as Error).message }); } },
  };
}
