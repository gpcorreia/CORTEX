import type { Request, Response } from "express";
import { readShopifyOrders } from "../services/orders.services.js";
import { getCampaignsForOrderAssignment } from "../repositories/campaign.repository.js";
import { assignCampaignsToOrders } from "../services/campaign.services.js";
import { insertOrders, getAllInfoDashboardFromDatabase } from "../repositories/orders.repository.js";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

function queryValue(value: unknown) {
  return typeof value === "string" ? value : "";
}



export async function getOrdersfromShopify(req: Request, res: Response) {
    
  const from = queryValue(req.query.from);
  const to = queryValue(req.query.to);
  const after = queryValue(req.query.after) || null;

  if (!isoDate.test(from) || !isoDate.test(to) || from > to) {
    res.status(400).json({
      error: "Indica from e to no formato YYYY-MM-DD, com from anterior ou igual a to.",
    });
    return;
  }

  const orders = await readShopifyOrders(from, to, after);
  const campaigns = await getCampaignsForOrderAssignment();
  const assignedOrders = assignCampaignsToOrders(orders.ShopifyOrders, campaigns);

  const checkInsert = await insertOrders(assignedOrders);
  
  if(!checkInsert) {
    res.status(500).json({ error: "Erro ao inserir pedidos no banco de dados." });
    return;
  } 

  res.json({ from, to, pageInfo: orders.pageInfo, ShopifyOrders: assignedOrders });
}


export async function getAllOrders(req: Request, res: Response) {
  
  try {
    const allOrders = await getAllInfoDashboardFromDatabase();

    const totalRevenyue = allOrders.reduce((total, order) => total + (order.total_price || 0), 0);
    const totalOrders = allOrders.length;
    const totalCostofGoodsSold = allOrders.reduce((total, order) => total + (order.cogs_eur || 0), 0);


    res.json({ orders: allOrders });
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar pedidos." });
  }
}










