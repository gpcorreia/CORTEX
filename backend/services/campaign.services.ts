import type { CampaignForOrderAssignment } from "../repositories/campaign.repository.js";
import type { MappedShopifyOrder } from "./orders.services.js";

type OrderForDailyMetrics = {
  quantity: number | null;
  revenue_eur: number;
  unit_cost_eur: number | string | null;
  shipping_cost_eur: number | string | null;
};

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function campaignForOrder(
  order: MappedShopifyOrder,
  campaigns: CampaignForOrderAssignment[],
) {
  const orderDate = order.ordered_at.slice(0, 10);
  const matches = campaigns.filter(
    (campaign) =>
      campaign.productId === order.product_id &&
      campaign.status === "active" &&
      campaign.started_on <= orderDate &&
      (!campaign.ended_on || campaign.ended_on >= orderDate),
  );
  return matches.length === 1 ? matches[0] : null;
}

// Prepares campaign assignments in memory only. It does not write to Supabase.
export function assignCampaignsToOrders(
  orders: MappedShopifyOrder[],
  campaigns: CampaignForOrderAssignment[],
) {
  const campaignProductIds = new Set(
    campaigns.map((campaign) => campaign.productId),
  );
  const assigned = orders.map((order) => {
    const campaign = campaignForOrder(order, campaigns);
    return { ...order, campaign_id: campaign?.id ?? null };
  });

  return assigned.map((order) => {
    if (order.campaign_id || !order.consumer_id) return order;

    // A product that has its own campaign (including a completed one) is a
    // genuine product sale, never a separate Express Priority line. Without
    // this guard, two different purchases by the same customer within six
    // minutes could be merged into the active campaign.
    if (campaignProductIds.has(order.product_id)) return order;

    const expressTime = new Date(order.ordered_at).getTime();
    const mainOrder = assigned
      .filter((candidate) => {
        const difference = expressTime - new Date(candidate.ordered_at).getTime();
        return (
          candidate.store_id === order.store_id &&
          candidate.consumer_id === order.consumer_id &&
          candidate.campaign_id !== null &&
          difference >= 0 &&
          difference <= 6 * 60 * 1000
        );
      })
      .sort(
        (a, b) =>
          new Date(b.ordered_at).getTime() - new Date(a.ordered_at).getTime(),
      )[0];

    return mainOrder ? { ...order, campaign_id: mainOrder.campaign_id } : order;
  });
}

export async function calculateDailyMetrics(
  orders: OrderForDailyMetrics[],
  adSpentEur: number,
) {
  const totalOrders = orders.length;
  const totalQuantity = orders.reduce(
    (total, order) => total + Number(order.quantity || 0),
    0,
  );
  const revenueEur = orders.reduce(
    (total, order) => total + Number(order.revenue_eur || 0),
    0,
  );
  const cogsEur = orders.reduce((total, order) => {
    const unitCost = Number(order.unit_cost_eur);
    const shippingCost = Number(order.shipping_cost_eur);
    if (!Number.isFinite(unitCost) || !Number.isFinite(shippingCost)) {
      throw new Error("Uma order da campanha tem custos invalidos.");
    }

    return total + Number(order.quantity) * unitCost + shippingCost;
  }, 0);
  const adSpendEur = Number(adSpentEur);
  const profitEur = revenueEur - adSpendEur - cogsEur;

  return {
    totalOrders,
    totalQuantity,
    revenue_eur: money(revenueEur),
    cogs_eur: money(cogsEur),
    ad_spend_eur: money(adSpendEur),
    profit_eur: money(profitEur),
    roas: adSpendEur > 0 ? money(revenueEur / adSpendEur) : null,
  };
}


export async function calculateAverageMetrics(
  history: any[],
) {
  const totalDays = history.length;
  if (totalDays === 0) return null;

  const totalRevenue = history.reduce((sum, day) => sum + Number(day.revenue_eur || 0), 0);
  const totalCogs = history.reduce((sum, day) => sum + Number(day.cogs_eur || 0), 0);
  const totalAdSpend = history.reduce((sum, day) => sum + Number(day.ad_spend_eur || 0), 0);
  const totalProfit = history.reduce((sum, day) => sum + Number(day.profit_eur || 0), 0);

  const averageRoas = totalAdSpend > 0 ? totalRevenue / totalAdSpend : null;

  return {
    totalRevenue: money(totalRevenue),
    totalCogs: money(totalCogs),
    totalAdSpend: money(totalAdSpend),
    totalProfit: money(totalProfit),
    averageRoas: averageRoas !== null ? money(averageRoas) : null,
  };
}
