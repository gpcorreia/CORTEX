import type { NextFunction, Request, Response } from "express";
import { env } from "../configs/env.js";

const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function allowedOrigins(req: Request) {
  const origins = new Set<string>();
  const host = req.get("host");
  if (host) origins.add(`${req.protocol}://${host}`);
  if (env.appOrigin) origins.add(env.appOrigin);
  return origins;
}

export function requireSameOrigin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!stateChangingMethods.has(req.method)) {
    next();
    return;
  }
  const source = req.get("origin") || req.get("referer");
  if (!source) {
    res.status(403).json({ error: "Pedido sem origem válida." });
    return;
  }
  try {
    if (!allowedOrigins(req).has(new URL(source).origin)) {
      res.status(403).json({ error: "Origem do pedido não autorizada." });
      return;
    }
  } catch {
    res.status(403).json({ error: "Origem do pedido inválida." });
    return;
  }
  next();
}
