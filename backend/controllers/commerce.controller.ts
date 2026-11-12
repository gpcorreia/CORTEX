import type { NextFunction, Request, Response } from "express";
import { getCommerceData } from "../services/commerce.services.js";

export async function getCommerce(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.json(await getCommerceData());
  } catch (error) {
    next(error);
  }
}
