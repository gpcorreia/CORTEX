import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../configs/env.js";

export type AdminRequest = Request & {
  admin?: { id: string; email: string; role: "admin" };
};

function readCookie(req: Request, name: string): string | null {
  const cookies = req.headers.cookie?.split(";") ?? [];
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(value.join("="));
    } catch {
      return null;
    }
  }
  return null;
}

function verifyAdminToken(
  req: AdminRequest,
): { id: string; email: string; role: "admin" } | null {
  const token = readCookie(req, env.adminCookieName);
  if (!token || !env.jwtSecret || !env.adminEmail) return null;
  try {
    const payload = jwt.verify(token, env.jwtSecret, {
      algorithms: ["HS256"],
      issuer: env.jwtIssuer,
      audience: env.jwtAudience,
    }) as jwt.JwtPayload & { email?: string; role?: string };
    const email = String(payload.email ?? "").toLowerCase();
    if (payload.role !== "admin" || email !== env.adminEmail || !payload.sub)
      return null;
    return { id: payload.sub, email, role: "admin" };
  } catch {
    return null;
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "strict" as const,
    path: "/",
    maxAge: env.adminSessionMaxAgeMs,
  };
}

function clearInvalidCookie(req: Request, res: Response) {
  if (readCookie(req, env.adminCookieName))
    res.clearCookie(env.adminCookieName, cookieOptions());
}

export function protectAdmin(
  req: AdminRequest,
  res: Response,
  next: NextFunction,
) {
  const admin = verifyAdminToken(req);
  if (!admin) {
    clearInvalidCookie(req, res);
    res.status(401).json({ error: "A sessão expirou. Inicia sessão novamente." });
    return;
  }
  req.admin = admin;
  res.setHeader("Cache-Control", "no-store");
  next();
}

export function protectAdminPage(
  req: AdminRequest,
  res: Response,
  next: NextFunction,
) {
  const admin = verifyAdminToken(req);
  if (!admin) {
    clearInvalidCookie(req, res);
    const target = encodeURIComponent(req.originalUrl || "/dashboard");
    res.redirect(303, `/login?next=${target}`);
    return;
  }
  req.admin = admin;
  res.setHeader("Cache-Control", "no-store");
  next();
}

export function redirectAuthenticatedAdmin(
  req: AdminRequest,
  res: Response,
  next: NextFunction,
) {
  if (verifyAdminToken(req)) {
    res.redirect(303, "/dashboard");
    return;
  }
  clearInvalidCookie(req, res);
  next();
}
