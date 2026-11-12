import { shopifyStatus } from "../configs/shopify.js";
import { getCommerceRows } from "../repositories/commerce.repository.js";

type Row = Record<string, unknown>;

const colours = ["green", "purple", "sand", "pink"];
const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const date = (value: unknown) => text(value).slice(0, 10);

function campaignStatus(value: unknown) {
  const status = text(value).toLowerCase();
  if (status === "active") return "Active";
  if (status === "paused") return "Paused";
  if (status === "killed") return "Killed";
  if (status === "completed" || status === "inactive") return "Completed";
  return "Planned";
}

function expenseType(value: unknown) {
  return text(value).toLowerCase().includes("subscription")
    ? "Subscription"
    : "One-time";
}

function expenseProvider(expense: Row) {
  const direct = text(expense.provider);
  if (direct) return direct;
  const match = text(expense.notes).match(/(?:^|\s)Fornecedor:\s*([^.;]+)/i);
  return match?.[1]?.trim() ?? "";
}

export async function getCommerceData() {
  const rows = await getCommerceRows();
  const productsById = new Map(rows.products.map((product) => [text(product.id), product]));
  const storesById = new Map(rows.stores.map((store) => [text(store.id), store]));
  const ordersByCampaign = new Map<string, Row[]>();
  const dailyByCampaign = new Map<string, Row[]>();

  for (const order of rows.orders) {
    const campaignId = text(order.campaign_id);
    if (!campaignId) continue;
    const campaignOrders = ordersByCampaign.get(campaignId) ?? [];
    campaignOrders.push(order);
    ordersByCampaign.set(campaignId, campaignOrders);
  }
  for (const daily of rows.dailyStats) {
    const campaignId = text(daily.campaign_id);
    const campaignDaily = dailyByCampaign.get(campaignId) ?? [];
    campaignDaily.push(daily);
    dailyByCampaign.set(campaignId, campaignDaily);
  }

  const campaigns = rows.campaigns.map((campaign, index) => {
    const product = productsById.get(text(campaign.product_id));
    const store = storesById.get(text(campaign.store_id || product?.store_id));
    const orders = (ordersByCampaign.get(text(campaign.id)) ?? [])
      .map((order) => ({
        id: text(order.id),
        number: text(order.order_number),
        date: date(order.ordered_at),
        quantity: number(order.quantity),
        revenue: number(order.revenue_eur),
        productCost: number(order.quantity) * number(order.unit_cost_eur),
        shipping: number(order.shipping_cost_eur),
        otherCost: number(order.other_cost_eur),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
    const daily = (dailyByCampaign.get(text(campaign.id)) ?? [])
      .map((stat) => ({
        date: date(stat.date || stat.stat_date),
        spend: number(stat.ad_spend_eur),
        revenue: number(stat.revenue_eur || stat.legacy_revenue_eur),
        cogs: number(stat.cogs_eur || stat.legacy_cogs_eur),
        orders: number(stat.total_orders || stat.legacy_orders_count),
        units: null,
        quality: "complete" as const,
        notes: text(stat.notes),
        hasSpendRecord: true,
        legacy: false,
        overlap: false,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      id: text(campaign.id),
      product: text(product?.name) || "Produto sem nome",
      productId: text(campaign.product_id),
      name: text(campaign.name),
      store: text(store?.name) || "Loja",
      start: date(campaign.started_on),
      budget: number(campaign.daily_budget_eur),
      url: text(campaign.funnel_url || campaign.affiliate_url),
      status: campaignStatus(campaign.status),
      color: colours[index % colours.length],
      spend: daily.map((stat) => ({ date: stat.date, amount: stat.spend })),
      orders,
      ...(daily.length ? { daily } : {}),
      history: [],
    };
  });

  const unattributedOrders = rows.orders
    .filter((order) => !text(order.campaign_id))
    .map((order) => ({
      id: text(order.id),
      number: text(order.order_number),
      date: date(order.ordered_at),
      quantity: number(order.quantity),
      revenue: number(order.revenue_eur),
      productCost: number(order.quantity) * number(order.unit_cost_eur),
      shipping: number(order.shipping_cost_eur),
      otherCost: number(order.other_cost_eur),
    }));

  const expenses = rows.expenses.map((expense) => ({
    id: text(expense.id),
    name: text(expense.name),
    provider: expenseProvider(expense),
    category: text(expense.category),
    amount: number(expense.amount_eur || expense.amount),
    date: date(expense.first_charge_on || expense.date),
    type: expenseType(expense.expense_type || expense.type),
    frequency: text(expense.frequency).toLowerCase() === "yearly" ? "Yearly" : "Monthly",
    nextBilling: date(expense.next_billing_on || expense.next_billing),
    trialEnd: date(expense.trial_end),
    notes: text(expense.notes),
    status: text(expense.status),
  }));

  return {
    campaigns,
    expenses,
    source: "supabase" as const,
    readOnly: true,
    asOf: new Date().toISOString().slice(0, 10),
    loadedAt: new Date().toISOString(),
    unattributedOrders,
    shopify: shopifyStatus(),
  };
}
