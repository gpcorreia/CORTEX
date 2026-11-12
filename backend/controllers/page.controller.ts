import type { RequestHandler } from "express";
import path from "node:path";

export function createPageController(publicDir: string) {
  const page = (file: string): RequestHandler => (_req, res) => res.sendFile(path.join(publicDir, file));
  return {
    workflows: page("workflows.html"),
    competitors: page("competitors.html"),
    cortex: page("cortex.html"),
  };
}
