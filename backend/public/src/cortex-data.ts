export type Status = "Active" | "Paused" | "Killed" | "Planned" | "Completed";
export interface DailyStat {
  date: string;
  spend: number;
  revenue: number;
  cogs: number;
  orders: number;
  units: number | null;
  quality: "complete" | "estimated" | "incomplete";
  notes: string;
  hasSpendRecord: boolean;
  legacy: boolean;
  overlap: boolean;
}
export interface Order {
  id: string;
  date: string;
  quantity: number;
  revenue: number;
  productCost: number;
  shipping: number;
  otherCost?: number;
  number?: string;
}
export interface Campaign {
  id: string;
  product: string;
  name: string;
  store: string;
  start: string;
  budget: number;
  url: string;
  status: Status;
  color: string;
  productId?: string;
  notes?: string;
  daily?: DailyStat[];
  spend: { date: string; amount: number }[];
  orders: Order[];
  history: {
    date: string;
    before: number | null;
    after: number;
    reason?: string;
  }[];
}
export interface Expense {
  id: string;
  name: string;
  provider: string;
  category: string;
  amount: number;
  date: string;
  type: "One-time" | "Subscription";
  frequency: "Monthly" | "Yearly";
  nextBilling: string;
  notes?: string;
  status?: string;
}
export interface CortexData {
  campaigns: Campaign[];
  expenses: Expense[];
  source?: "supabase";
  readOnly?: boolean;
  asOf?: string;
  loadedAt?: string;
  warnings?: string[];
  unattributedOrders?: Order[];
  expenseSchedule?: { expenseId: string; date: string; amount: number }[];
  shopify?: { configured: boolean; apiVersion: string };
}
const campaign = (
  id: string,
  product: string,
  start: string,
  status: Status,
  color: string,
  revenue: number,
  spend: number,
  costs: number,
): Campaign => ({
  id,
  product,
  name: `${product} · Portugal`,
  store: "Minha Loja",
  start,
  budget: 50,
  url: "",
  status,
  color,
  spend: [
    { date: start, amount: spend * 0.6 },
    { date: "2026-11-04", amount: spend * 0.4 },
  ],
  orders: [
    {
      id: `${id}-1001`,
      date: start,
      quantity: 5,
      revenue: revenue * 0.7,
      productCost: costs * 0.7 - 6.48,
      shipping: 6.48,
    },
    {
      id: `${id}-1002`,
      date: "2026-11-04",
      quantity: 2,
      revenue: revenue * 0.3,
      productCost: costs * 0.3 - 2,
      shipping: 2,
    },
  ],
  history: [],
});
const seed: CortexData = {
  campaigns: [
    campaign(
      "veloma",
      "Veloma",
      "2026-11-03",
      "Active",
      "green",
      383.05,
      288.55,
      75.22,
    ),
    campaign("krudova", "Krudova", "2026-10-26", "Killed", "sand", 95, 122, 22),
    campaign(
      "handlinde",
      "Handlinde",
      "2026-10-25",
      "Killed",
      "pink",
      43.9,
      82.31,
      10.79,
    ),
    campaign("silena", "Silena", "2026-11-01", "Paused", "purple", 130, 45, 27),
  ],
  expenses: [
    {
      id: "shopify",
      name: "Plano Basic",
      provider: "Shopify",
      category: "Plataforma",
      amount: 36,
      date: "2026-11-01",
      type: "Subscription",
      frequency: "Monthly",
      nextBilling: "2026-12-01",
    },
    {
      id: "domain",
      name: "Domínio da loja",
      provider: "Cloudflare",
      category: "Infraestrutura",
      amount: 12,
      date: "2026-10-26",
      type: "Subscription",
      frequency: "Yearly",
      nextBilling: "2027-10-26",
    },
    {
      id: "creative",
      name: "Produção de criativos",
      provider: "Estúdio",
      category: "Criativos",
      amount: 150,
      date: "2026-10-28",
      type: "One-time",
      frequency: "Monthly",
      nextBilling: "",
    },
  ],
};
async function api<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Não foi possível carregar os dados.");
  return result as T;
}
export const cortexData = {
  async load(): Promise<CortexData> {
    if (new URLSearchParams(location.search).get("demo") !== "1")
      return api<CortexData>("/api/commerce");
    const raw = sessionStorage.getItem("cortex-demo-v1");
    return raw ? (JSON.parse(raw) as CortexData) : structuredClone(seed);
  },
  async save(data: CortexData): Promise<void> {
    if (data.readOnly)
      throw new Error(
        "A ligação à Supabase está em modo de leitura nesta fase.",
      );
    sessionStorage.setItem("cortex-demo-v1", JSON.stringify(data));
  },
  async campaign(id: string): Promise<Campaign> {
    return (
      await api<{ campaign: Campaign }>(
        `/api/campaigns/${encodeURIComponent(id)}`,
      )
    ).campaign;
  },
};
export const totals = (c: Campaign, from = "", to = "9999") => {
  const orders = c.orders.filter((o) => o.date >= from && o.date <= to);
  const daily = c.daily?.filter((d) => d.date >= from && d.date <= to);
  const revenue = daily
      ? daily.reduce((s, d) => s + d.revenue, 0)
      : orders.reduce((s, o) => s + o.revenue, 0),
    cogs = daily
      ? daily.reduce((s, d) => s + d.cogs, 0)
      : orders.reduce(
          (s, o) => s + o.productCost + o.shipping + (o.otherCost ?? 0),
          0,
        ),
    spend = daily
      ? daily.reduce((s, d) => s + d.spend, 0)
      : c.spend
          .filter((d) => d.date >= from && d.date <= to)
          .reduce((s, d) => s + d.amount, 0);
  return {
    revenue,
    cogs,
    spend,
    profit: revenue - cogs - spend,
    roas: spend ? revenue / spend : 0,
    ber: revenue > cogs ? revenue / (revenue - cogs) : 0,
    orders: daily ? daily.reduce((s, d) => s + d.orders, 0) : orders.length,
    units: daily
      ? daily.some((d) => d.units === null)
        ? null
        : daily.reduce((s, d) => s + (d.units ?? 0), 0)
      : orders.reduce((s, o) => s + o.quantity, 0),
    incomplete: daily?.some((d) => d.quality === "incomplete") ?? false,
    estimated: daily?.some((d) => d.quality === "estimated") ?? false,
  };
};

export function shiftDate(date: string, days: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function legacyThreeDayDecision(c: Campaign, end: string, today: string) {
  const through = end >= today ? shiftDate(today, -1) : end,
    start = shiftDate(through, -2);
  const days = [start, shiftDate(start, 1), through];
  const stats = days.map((day) => c.daily?.find((d) => d.date === day));
  const t = totals(c, start, through);
  let action: "KEEP" | "KILL" | "AGUARDAR" | "REVER" = "AGUARDAR";
  let reason =
    "São necessários 3 dias completos e consecutivos, com investimento registado.";
  if (stats.every((d) => d && d.hasSpendRecord) && start >= c.start) {
    if (t.incomplete || t.estimated) {
      action = "REVER";
      reason =
        "Existem custos estimados, valores em falta ou sobreposição com o histórico. Confirma os dados antes de decidir.";
    } else if (t.spend > 0) {
      action = t.profit > 0 ? "KEEP" : t.profit < 0 ? "KILL" : "REVER";
      reason =
        t.profit === 0
          ? "Período no break-even; sem profit positivo ou negativo."
          : "ROAS agregado = receita dos 3 dias ÷ Ads dos 3 dias. Profit = receita − Ads − COGS.";
    }
  }
  return { action, reason, from: start, to: through, ...t };
}

export function threeDayDecision(c: Campaign, end: string, today: string) {
  const through = end >= today ? shiftDate(today, -1) : end;
  const stats = (c.daily ?? [])
    .filter((stat) => stat.date >= c.start && stat.date <= through && stat.hasSpendRecord)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3)
    .sort((a, b) => a.date.localeCompare(b.date));
  const from = stats[0]?.date ?? shiftDate(through, -2);
  const totalsForStats = stats.reduce(
    (total, stat) => ({
      revenue: total.revenue + stat.revenue,
      cogs: total.cogs + stat.cogs,
      spend: total.spend + stat.spend,
      orders: total.orders + stat.orders,
      incomplete: total.incomplete || stat.quality === "incomplete",
      estimated: total.estimated || stat.quality === "estimated",
    }),
    { revenue: 0, cogs: 0, spend: 0, orders: 0, incomplete: false, estimated: false },
  );
  const profit = totalsForStats.revenue - totalsForStats.cogs - totalsForStats.spend;
  const metrics = {
    ...totalsForStats,
    profit,
    roas: totalsForStats.spend ? totalsForStats.revenue / totalsForStats.spend : 0,
    ber: totalsForStats.revenue > totalsForStats.cogs
      ? totalsForStats.revenue / (totalsForStats.revenue - totalsForStats.cogs)
      : 0,
    units: null,
  };
  let action: "KEEP" | "KILL" | "AGUARDAR" | "REVER" = "AGUARDAR";
  let reason = "Sao necessarios 3 Daily Stats completos, com investimento registado.";

  if (stats.length === 3) {
    if (metrics.incomplete || metrics.estimated) {
      action = "REVER";
      reason = "Existem valores em falta ou estimados. Confirma os dados antes de decidir.";
    } else if (metrics.spend > 0) {
      action = metrics.profit > 0 ? "KEEP" : metrics.profit < 0 ? "KILL" : "REVER";
      reason = metrics.profit === 0
        ? "Periodo no break-even; sem profit positivo ou negativo."
        : "ROAS agregado = receita dos 3 Daily Stats dividido por Ads. Profit = receita menos Ads menos COGS.";
    }
  }

  return { action, reason, from, to: stats.at(-1)?.date ?? through, ...metrics };
}
