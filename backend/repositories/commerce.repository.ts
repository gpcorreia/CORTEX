import { supabase } from "../configs/supabase.js";

type CommerceRows = {
  campaigns: Record<string, unknown>[];
  products: Record<string, unknown>[];
  orders: Record<string, unknown>[];
  dailyStats: Record<string, unknown>[];
  stores: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
};

function resultRows(
  data: Record<string, unknown>[] | null,
  error: { message: string } | null,
  source: string,
) {
  if (error) throw new Error(`Erro ao buscar ${source}: ${error.message}`);
  return data ?? [];
}

export async function getCommerceRows(): Promise<CommerceRows> {
  const [campaigns, products, orders, dailyStats, stores, expenses] =
    await Promise.all([
      supabase.from("ec_campaigns").select("*"),
      supabase.from("ec_products").select("*"),
      supabase.from("ec_orders").select("*"),
      supabase.from("ec_campaign_daily_stats").select("*"),
      supabase.from("ec_stores").select("*"),
      supabase.from("ec_expenses").select("*"),
    ]);

  return {
    campaigns: resultRows(campaigns.data, campaigns.error, "campanhas"),
    products: resultRows(products.data, products.error, "produtos"),
    orders: resultRows(orders.data, orders.error, "orders"),
    dailyStats: resultRows(dailyStats.data, dailyStats.error, "daily stats"),
    stores: resultRows(stores.data, stores.error, "lojas"),
    expenses: resultRows(expenses.data, expenses.error, "despesas"),
  };
}
