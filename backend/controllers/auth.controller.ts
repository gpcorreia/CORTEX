import bcrypt from "bcrypt";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../configs/env.js";
import {
  createUser,
  getUserByEmail,
  type NewUser,
} from "../repositories/auth.repository.js";

const AUTH_COOKIE = "cortex_session";
const isProduction = process.env.NODE_ENV === "production";
const cookieOptions = {
  httpOnly: true,
  secure: isProduction,
  path: "/",
  sameSite: "strict" as const,
  maxAge: 24 * 60 * 60 * 1000,
};

function jwtSecret() {
  if (!env.jwtSecret) {
    throw Object.assign(new Error("JWT_SECRET não está configurado."), {
      status: 503,
    });
  }
  return env.jwtSecret;
}

export async function handleSignup(req: Request, res: Response) {
  const name = String(req.body?.name ?? "").trim();
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  if (!name || !email || password.length < 8) {
    res.status(400).json({
      error: "Indica nome, email e uma palavra-passe com pelo menos 8 caracteres.",
    });
    return;
  }
  if (await getUserByEmail(email)) {
    res.status(409).json({ error: "Já existe uma conta com este email." });
    return;
  }
  const user: NewUser = {
    name,
    email,
    password: await bcrypt.hash(password, 12),
    role: email === env.adminEmail ? "admin" : "employee",
    status: "active",
  };
  const created = await createUser(user);
  res.status(201).json({
    message: "Conta criada com sucesso.",
    user: {
      id: created.id,
      name: created.name,
      email: created.email,
      role: created.role,
    },
  });
}

export async function handleLogin(req: Request, res: Response) {
  const email = String(req.body?.email ?? req.body?.username ?? "")
    .trim()
    .toLowerCase();
  const password = String(req.body?.password ?? "");
  if (!email || !password) {
    res.status(400).json({ error: "Indica o email e a palavra-passe." });
    return;
  }
  const user = await getUserByEmail(email);
  const validPassword =
    user && (await bcrypt.compare(password, user.password));
  if (!user || user.status !== "active" || !validPassword) {
    res.status(401).json({ error: "Email ou palavra-passe incorretos." });
    return;
  }
  const token = jwt.sign(
    { email: user.email, role: user.role },
    jwtSecret(),
    {
      subject: String(user.id),
      algorithm: "HS256",
      issuer: env.jwtIssuer,
      audience: env.jwtAudience,
      expiresIn: "1d",
    },
  );
  res.cookie(AUTH_COOKIE, token, cookieOptions);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    authenticated: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
}

export function handleLogout(_req: Request, res: Response) {
  res.clearCookie(AUTH_COOKIE, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    path: "/",
  });
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ message: "Sessão terminada." });
}
