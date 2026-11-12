import {
  cortexData,
  totals,
  threeDayDecision,
  type CortexData,
  type Campaign,
  type Expense,
  type Status,
} from "./cortex-data.js";
import { icon } from "./cortex-shell.js";
const root = document.querySelector<HTMLElement>("#cortex-app")!;
const dialog = document.querySelector<HTMLDialogElement>("#cortex-dialog")!;
type ProductOption = { id: string; name: string; shopify_product_id: string };
let availableProducts: ProductOption[] = [];
let data: CortexData,
  selected =
    location.pathname.split("/")[2] ||
    new URLSearchParams(location.search).get("campaign") ||
    "",
  tab = "overview",
  search = "",
  status = "Active";
let from = "2026-10-25",
  to = "2026-11-05";
const page = location.pathname.split("/")[1];
let initialized = false;
const demoQuery = () => (data.source ? "" : "?demo=1");
const esc = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const money = (v: number) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(
    v,
  );
const date = (v: string) =>
  new Date(v + "T12:00:00").toLocaleDateString("pt-PT", {
    day: "numeric",
    month: "short",
  });
const ratio = (v: number) => (v ? v.toFixed(2).replace(".", ",") + "x" : "—");
const profit = (v: number) =>
  `<strong class="${v >= 0 ? "positive" : "negative"}">${v > 0 ? "+" : ""}${money(v)}</strong>`;
const labels = {
  Active: "Ativa",
  Paused: "Pausada",
  Killed: "Finalizada",
  Planned: "Planeada",
  Completed: "Concluída",
};
const badge = (v: Status) =>
  `<span class="badge ${v.toLowerCase()}">${labels[v]}</span>`;
const thumb = (c: Campaign) =>
  `<span class="product-thumb ${c.color}" aria-hidden="true"><span>${esc(c.product.slice(0, 7))}</span></span>`;
const card = (title: string, body: string, extra = "") =>
  `<section class="panel ${extra}"><h2>${title}</h2>${body}</section>`;
const table = (headers: string[], rows: string[]) =>
  rows.length
    ? `<div class="table-scroll"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
    : '<p class="empty-state">Sem registos neste período.</p>';
const row = (...cells: string[]) =>
  `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
const button = (action: string, text: string, cls = "", id = "") =>
  `<button type="button" class="${cls}" ${data?.readOnly && !["select", "orders", "retry", "refresh", "new-product", "new-campaign", "deactivate-campaign", "import-orders", "add-spend", "new-expense", "edit-expense", "deactivate-expense"].includes(action) ? 'disabled title="Edição na Supabase disponível numa próxima fase"' : ""} data-action="${action}" ${id ? `data-id="${esc(id)}"` : ""}>${text}</button>`;
function kpis(t: ReturnType<typeof totals>, ber = false) {
  return `<div class="kpi-grid ${ber ? "six" : ""}">${[["Revenue", t.incomplete ? "Por confirmar" : money(t.revenue), "research"], ["Ad Spend", money(t.spend), "campaigns"], ["COGS", t.incomplete ? "Por confirmar" : t.incomplete ? "Por confirmar" : money(t.cogs), "expenses"], ["Profit", t.incomplete ? "Por confirmar" : t.incomplete ? "Por confirmar" : profit(t.profit), "expenses"], ["ROAS", t.incomplete ? "Por confirmar" : ratio(t.roas), "dashboard"], ...(ber ? [["BER", t.incomplete ? "Por confirmar" : ratio(t.ber), "workflow"]] : [])].map(([label, value, glyph]) => `<div class="panel kpi"><span class="kpi-icon">${icon(glyph)}</span><div><span class="muted">${label}</span><b>${value}</b></div></div>`).join("")}</div>`;
}
function dates(campaigns: Campaign[]) {
  return [
    ...new Set(
      campaigns.flatMap((c) => [
        ...c.spend.map((d) => d.date),
        ...c.orders.map((o) => o.date),
      ]),
    ),
  ]
    .filter((d) => d >= from && d <= to)
    .sort();
}
function chart(campaigns: Campaign[], cumulative = true) {
  if (campaigns.some((c) => totals(c, from, to).incomplete))
    return '<p class="empty-state">Gráfico indisponível: existem valores históricos por confirmar neste período.</p>';
  const days = dates(campaigns);
  if (!days.length)
    return '<p class="empty-state">Sem dados no período selecionado.</p>';
  let running = 0;
  const values = days.map((d) => {
    const t = campaigns.map((c) => totals(c, d, d));
    const p = t.reduce((s, t) => s + t.profit, 0);
    running += p;
    return cumulative ? running : t.reduce((s, t) => s + t.revenue, 0);
  });
  const spend = days.map((d) =>
    campaigns.reduce((s, c) => s + totals(c, d, d).spend, 0),
  );
  const all = cumulative ? values : [...values, ...spend];
  const min = Math.min(0, ...all),
    max = Math.max(1, ...all),
    x = (i: number) => 60 + (i * 560) / Math.max(1, days.length - 1),
    y = (v: number) => 190 - ((v - min) / (max - min)) * 160;
  const line = (vals: number[], color: string) =>
    `<polyline points="${vals.map((v, i) => `${x(i)},${y(v)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="2.5"/>${vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${color}"><title>${date(days[i])}: ${money(v)}</title></circle>`).join("")}`;
  return `<div class="chart-legend">${cumulative ? "● Profit acumulado" : '<span class="positive">● Revenue</span>　● Ad Spend'}</div><svg class="chart" viewBox="0 0 680 230" role="img" aria-label="${cumulative ? "Profit acumulado" : "Receita e investimento publicitário por dia"}"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#b452ff" stop-opacity=".3"/><stop offset="1" stop-color="#b452ff" stop-opacity="0"/></linearGradient></defs>${[
    0, 1, 2, 3, 4,
  ]
    .map((i) => {
      const v = min + ((max - min) * i) / 4;
      return `<path d="M60 ${y(v)}H640" stroke="#303445"/><text x="50" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}€</text>`;
    })
    .join(
      "",
    )}${cumulative ? `<polygon points="60,190 ${values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} ${x(values.length - 1)},190" fill="url(#area)"/>` : ""}${line(values, cumulative ? "#c36aff" : "#23e9a0")}${cumulative ? "" : line(spend, "#c36aff")}${days.map((d, i) => `<text x="${x(i)}" y="218" text-anchor="middle">${date(d)}</text>`).join("")}</svg>`;
}
function header() {
  const title =
    page === "dashboard"
      ? "Dashboard Geral"
      : page === "campaigns"
        ? "Campanhas"
        : "Despesas";
  const createActions = page === "campaigns"
    ? `${button("import-orders", "Importar orders Shopify")}${button("new-product", "+ Novo Produto")}${button("new-campaign", "+ Nova Campanha", "accent")}`
    : page === "expenses"
      ? button("new-expense", "+ Nova Despesa", "accent")
      : "";
  return `<header class="page-header"><div><h1>${title}</h1><p>${page === "dashboard" ? "Visão global do teu e-commerce" : page === "campaigns" ? "Gere as tuas campanhas, acompanha resultados e analisa as encomendas." : "Controla os custos e as subscrições do teu negócio."}</p></div><div class="header-actions"><div class="date-range"><label>De <input type="date" id="date-from" value="${from}" aria-label="Data inicial"></label><label>Até <input type="date" id="date-to" value="${to}" aria-label="Data final"></label></div>${button("refresh", "Atualizar")}${createActions}</div></header><div class="demo-note"><span class="online-dot"></span> ${data.source ? `Supabase · Dados reais em leitura <span>· Atualizado ${new Date(data.loadedAt!).toLocaleTimeString("pt-PT")} · Shopify ${data.shopify?.configured ? "configurado" : "por configurar"}</span>` : "Modo demonstração <span>· Dados fictícios · Alterações guardadas nesta sessão do navegador</span>"}</div>`;
}
function campaignRows() {
  return data.campaigns.map((c) => {
    const t = totals(c, from, to);
    return row(
      `<a class="product-link" href="/campaigns/${c.id}${demoQuery()}">${thumb(c)}<b>${esc(c.product)}</b></a>`,
      date(c.start),
      badge(c.status),
      money(t.spend),
      t.incomplete ? "Por confirmar" : money(t.revenue),
      t.incomplete ? "Por confirmar" : money(t.cogs),
      t.incomplete ? "Por confirmar" : profit(t.profit),
      t.incomplete ? "Por confirmar" : ratio(t.roas),
      decisionFor(c, to),
    );
  });
}
function decisionFor(c: Campaign, through: string) {
  const r = threeDayDecision(c, through, data.asOf || to);
  return `<span class="decision ${r.action === "KILL" ? "negative" : r.action === "KEEP" ? "positive" : "muted"}" title="${esc(r.reason)}">${r.action}</span>`;
}
function reviewCard(c: Campaign) {
  const r = threeDayDecision(c, to, data.asOf || to);
  return card(
    "Decisão · últimos 3 dias completos",
    `<div class="decision-summary">${decisionFor(c, to)}<span>${date(r.from)} – ${date(r.to)}</span><b>ROAS: ${r.incomplete ? "Por confirmar" : ratio(r.roas)}</b><b>Profit: ${r.incomplete ? "Por confirmar" : money(r.profit)}</b></div><p class="section-note">${esc(r.reason)} SCALE: limite por definir. O dia em curso não entra nesta decisão.</p>`,
  );
}
function dashboard() {
  const ts = data.campaigns.map((c) => totals(c, from, to));
  const t = ts.reduce(
    (a, b) => ({
      ...a,
      revenue: a.revenue + b.revenue,
      spend: a.spend + b.spend,
      cogs: a.cogs + b.cogs,
      profit: a.profit + b.profit,
      incomplete: a.incomplete || b.incomplete,
      estimated: a.estimated || b.estimated,
    }),
    {
      revenue: 0,
      spend: 0,
      cogs: 0,
      profit: 0,
      roas: 0,
      ber: 0,
      orders: 0,
      units: 0,
      incomplete: false,
      estimated: false,
    },
  );
  for (const o of data.unattributedOrders ?? []) {
    if (o.date >= from && o.date <= to) {
      t.revenue += o.revenue;
      t.cogs += o.productCost + o.shipping + (o.otherCost ?? 0);
      t.profit += o.revenue - o.productCost - o.shipping - (o.otherCost ?? 0);
    }
  }
  t.roas = t.spend ? t.revenue / t.spend : 0;
  const expenses = (data.expenseSchedule ?? data.expenses)
      .filter((e) => e.date >= from && e.date <= to)
      .reduce((s, e) => s + e.amount, 0),
    investment = t.spend + t.cogs + expenses,
    net = t.profit - expenses,
    progress = investment ? Math.min(100, (t.revenue / investment) * 100) : 0;
  return `${kpis(t)}<div class="overview-grid">${card("Evolução do Profit Acumulado", chart(data.campaigns))}${card("Break-even do Negócio · estimativa", t.incomplete ? '<p class="empty-state">Break-even por confirmar: faltam valores no histórico. Consulta os avisos abaixo.</p>' : `<dl class="summary"><div><dt>Investimento (Ads + COGS + despesas)</dt><dd>${money(investment)}</dd></div><div><dt>Despesas operacionais no período</dt><dd>${money(expenses)}</dd></div><div><dt>Profit líquido</dt><dd>${profit(net)}</dd></div><div><dt>Falta recuperar</dt><dd>${money(Math.max(0, -net))}</dd></div></dl><div class="progress-row"><progress max="100" value="${progress}"></progress><b>${progress.toFixed(1)}%</b></div><div class="callout"><b>${net >= 0 ? "Break-even atingido" : "A recuperar investimento"}</b><p>${net >= 0 ? "A receita cobre todos os custos do período." : `Faltam ${money(-net)} para atingir o break-even.`}</p></div>`)}</div>${card(`Campanhas Recentes ${data.readOnly ? '<a class="button" href="/campaigns">Ver campanhas</a>' : '<a class="accent button" href="/campaigns?demo=1&new=1">+ Nova Campanha</a>'}`, table(["Produto / Campanha", "Início", "Status", "Ad Spend", "Revenue", "COGS", "Profit", "ROAS", "Decisão 3 dias"], campaignRows()))}`;
}
function orderTable(c: Campaign, compact = false) {
  const orders = c.orders.filter((o) => o.date >= from && o.date <= to);
  return table(
    [
      "Encomenda",
      "Data",
      "Quantidade",
      "Revenue",
      "Produto",
      "Shipping",
      "COGS",
      ...(compact ? [] : [""]),
    ],
    orders
      .slice(0, compact ? 3 : undefined)
      .map((o) =>
        row(
          `<b>${esc(o.number || o.id)}</b>`,
          date(o.date),
          String(o.quantity),
          money(o.revenue),
          money(o.productCost),
          money(o.shipping),
          money(o.productCost + o.shipping + (o.otherCost ?? 0)),
          ...(compact ? [] : [button("edit-order", "Editar custos", "", o.id)]),
        ),
      ),
  );
}
function dailyTable(c: Campaign, editable = false) {
  editable = editable && !data.readOnly;
  return table(
    [
      "Data",
      "Ad Spend",
      "Orders",
      "Revenue",
      "COGS",
      "Profit",
      "ROAS",
      "Decisão 3 dias",
      "Qualidade",
    ],
    dates([c]).map((d) => {
      const t = totals(c, d, d);
      return row(
        date(d),
        editable
          ? `<form data-spend="${d}" class="inline-form"><input type="number" aria-label="Ad spend ${d}" name="amount" min="0" max="100000000" step=".01" required value="${t.spend.toFixed(2)}"><button aria-label="Guardar investimento de ${d}">✓</button></form>`
          : money(t.spend),
        String(t.orders),
        t.incomplete ? "Por confirmar" : money(t.revenue),
        t.incomplete ? "Por confirmar" : money(t.cogs),
        t.incomplete ? "Por confirmar" : profit(t.profit),
        t.incomplete ? "Por confirmar" : ratio(t.roas),
        decisionFor(c, d),
        esc(
          c.daily?.find((s) => s.date === d)?.quality === "incomplete"
            ? "Por confirmar"
            : c.daily?.find((s) => s.date === d)?.quality === "estimated"
              ? "Estimado"
              : "Registado",
        ),
      );
    }),
  );
}
function campaignDetail(c: Campaign) {
  const t = totals(c, from, to);
  let body = "";
  if (tab === "overview")
    body = `${reviewCard(c)}${kpis(t, true)}<div class="overview-grid">${card("Evolução Diária", chart([c], false))}${card("Resumo da Campanha", `<dl class="summary"><div><dt>Encomendas</dt><dd>${t.orders}</dd></div><div><dt>Unidades vendidas</dt><dd>${t.units ?? "Não disponível no histórico"}</dd></div><div><dt>Ticket médio (AOV)</dt><dd>${t.orders && !t.incomplete ? money(t.revenue / t.orders) : "—"}</dd></div><div><dt>Custo por encomenda (CPA)</dt><dd>${t.orders ? money(t.spend / t.orders) : "—"}</dd></div><div><dt>Margem bruta</dt><dd class="positive">${t.incomplete ? "—" : t.revenue ? (((t.revenue - t.cogs) / t.revenue) * 100).toFixed(1) : "0"}%</dd></div><div><dt>BER</dt><dd>${t.incomplete ? "Por confirmar" : ratio(t.ber)}</dd></div></dl>`)}</div>${card("Profit Acumulado", chart([c]))}${card("Resultados Diários", dailyTable(c))}${card(`Últimas Encomendas ${button("orders", "Ver todas →", "text-button")}`, orderTable(c, true))}`;
  if (tab === "orders")
    body = card(
      data.source
        ? "Encomendas registadas na Supabase"
        : 'Encomendas Shopify <span class="muted">Demonstração</span>',
      `<p class="section-note">O COGS inclui produto, transporte e outros custos. Usa “Importar orders Shopify” para carregar o período e atribuir as encomendas às campanhas antes de fechar o dia.</p>${orderTable(c)}`,
    );
  if (tab === "daily")
    body = card(
      `Resultados Diários ${button("add-spend", "+ Registar dia")}`,
      `<p class="section-note">KEEP/KILL usa os últimos 3 Daily Stats disponíveis; o dia atual é excluído. ROAS agregado = soma da receita ÷ soma de Ads. SCALE aguarda definição.</p>${dailyTable(c, true)}`,
    );
  if (tab === "budget")
    body = card(
      "Orçamento Diário",
      `<div class="budget-value">${money(c.budget)} <span>/ dia</span></div>${button("edit-budget", "Editar orçamento", "accent")}<h3>Histórico de alterações</h3>${table(
        ["Data", "Anterior", "Novo orçamento"],
        c.history.map((h) =>
          row(
            new Date(h.date).toLocaleString("pt-PT"),
            h.before === null ? "—" : money(h.before),
            money(h.after),
          ),
        ),
      )}`,
    );
  const campaignAction = c.status === "Active"
    ? button("deactivate-campaign", "Desativar", "danger")
    : "";
  return `<div class="campaign-detail"><section class="panel campaign-heading"><div class="product-link">${thumb(c)}<div><h2>${esc(c.product)} ${badge(c.status)}</h2><p>Início: ${date(c.start)} ${esc(c.start.slice(0, 4))}　|　Loja: ${esc(c.store)}</p><small class="muted">${esc(c.name)}</small></div></div><div class="actions">${button("add-spend", "Registar Daily Status", "accent")}${campaignAction}</div></section><div class="tabs" role="tablist" aria-label="Detalhes da campanha">${[
    ["overview", "Visão Geral"],
    ["orders", "Orders (Encomendas)"],
    ["daily", "Resultados Diários"],
    ["budget", "Orçamento"],
  ]
    .map(
      ([id, label]) =>
        `<button role="tab" id="tab-${id}" aria-controls="campaign-tab" aria-selected="${tab === id}" data-tab="${id}">${label}</button>`,
    )
    .join(
      "",
    )}</div><div role="tabpanel" id="campaign-tab" aria-labelledby="tab-${tab}">${body}</div></div>`;
}
function campaigns() {
  const filtered = data.campaigns.filter(
    (c) =>
      (status === "all" || c.status === status) &&
      `${c.product} ${c.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  const requestedCampaign = data.campaigns.find((campaign) => campaign.id === selected);
  const visible = status === "all"
    ? data.campaigns.filter((campaign) =>
        `${campaign.product} ${campaign.name}`.toLowerCase().includes(search.toLowerCase()),
      )
    : filtered;
  const c = requestedCampaign && visible.some((campaign) => campaign.id === requestedCampaign.id)
    ? requestedCampaign
    : visible[0];
  selected = c?.id ?? "";
  const path = selected ? `/campaigns/${selected}` : '/campaigns';
  if (location.pathname !== path) history.replaceState({}, '', path + location.search);
  return `<div class="campaign-layout"><section class="campaign-list"><div class="list-filters"><select id="status-filter" aria-label="Filtrar estado"><option value="all" ${status === 'all' ? 'selected' : ''}>Todas (${data.campaigns.length})</option>${Object.entries(
    { Active: 'Ativas', Paused: 'Pausadas', Killed: 'Finalizadas', Planned: 'Planeadas', Completed: 'Concluídas' },
  )
    .map(
      ([v, l]) =>
        `<option value="${v}" ${status === v ? "selected" : ""}>${l} (${data.campaigns.filter((c) => c.status === v).length})</option>`,
    )
    .join(
      "",
    )}</select></div><input id="campaign-search" type="search" placeholder="Pesquisar campanha…" aria-label="Pesquisar campanha" value="${esc(search)}"><div class="campaign-cards">${
    visible.length
      ? visible
          .map((c) => {
            const t = totals(c, from, to);
            return `<button class="campaign-card ${selected === c.id ? "selected" : ""}" data-action="select" data-id="${c.id}" aria-pressed="${selected === c.id}"><div class="product-link">${thumb(c)}<div><b>${esc(c.product)}</b><small>Início: ${date(c.start)}</small></div>${badge(c.status)}</div><div class="mini-metrics">${[
              ["Spend", money(t.spend)],
              ["Revenue", t.incomplete ? "Por confirmar" : money(t.revenue)],
              ["Profit", t.incomplete ? "Por confirmar" : profit(t.profit)],
              ["ROAS", t.incomplete ? "Por confirmar" : ratio(t.roas)],
            ]
              .map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`)
              .join("")}</div></button>`;
          })
          .join("")
      : '<p class="empty-state">Nenhuma campanha encontrada. Ajusta os filtros ou cria uma campanha.</p>'
  }</div></section>${c ? campaignDetail(c) : card("As tuas campanhas", '<p class="empty-state">Sem campanha selecionada ou campanha não encontrada. Escolhe uma campanha da lista.</p>')}</div>`;
}
function expenses() {
  const filtered = data.expenses.filter((e) => e.date >= from && e.date <= to);
  const monthly = data.expenses
      .filter(
        (e) =>
          e.type === "Subscription" && (!e.status || e.status === "active"),
      )
      .reduce((s, e) => s + e.amount / (e.frequency === "Yearly" ? 12 : 1), 0),
    one = filtered
      .filter((e) => e.type === "One-time")
      .reduce((s, e) => s + e.amount, 0);
  return `<div class="expense-summary">${card("Subscrições · equivalente mensal", `<div class="budget-value">${money(monthly)}</div><p class="muted">Todas as subscrições; valores anuais divididos por 12.</p>`)}${card("Investimento pontual", `<div class="budget-value">${money(one)}</div><p class="muted">Despesas únicas no período selecionado.</p>`)}${card("Total no período", `<div class="budget-value">${money(filtered.reduce((s, e) => s + e.amount, 0))}</div><p class="muted">Registos com data dentro do filtro.</p>`)}</div>${card(
    "Despesas e Subscrições",
    table(
      [
        "Nome / Fornecedor",
        "Categoria",
        "Valor",
        "Data",
        "Tipo",
        "Frequência",
        "Próxima cobrança",
        "Ações",
      ],
      filtered.map((e) =>
        row(
          `<b>${esc(e.name)}</b><small class="cell-subtitle">${esc(e.provider)}</small>`,
          esc(e.category),
          money(e.amount),
          date(e.date),
          e.type === "Subscription"
            ? '<span class="badge subscription">Subscrição</span>'
            : "Pontual",
          e.type === "Subscription"
            ? e.frequency === "Monthly"
              ? "Mensal"
              : "Anual"
            : "—",
          e.type === "Subscription" && (!e.status || e.status === "active")
            ? date(e.nextBilling || e.date)
            : "—",
          `<div class="actions">${button("edit-expense", "Editar", "", e.id)}${e.type === "Subscription" && (!e.status || e.status === "active") ? button("deactivate-expense", "Desativar", "danger", e.id) : e.type === "Subscription" ? '<span class="badge completed">Desativada</span>' : ""}</div>`,
        ),
      ),
    ),
  )}`;
}
function render() {
  root.innerHTML =
    header() +
    (page === "dashboard"
      ? dashboard()
      : page === "campaigns"
        ? campaigns()
        : expenses());
  const warnings = [
    ...(data.warnings ?? []),
    ...data.campaigns
      .filter((c) => c.id === selected && page === "campaigns")
      .flatMap((c) => [
        c.notes ?? "",
        ...(c.daily ?? [])
          .filter((d) => d.notes)
          .map((d) => d.date + ": " + d.notes),
      ]),
  ].filter(Boolean);
  if (warnings.length)
    root.insertAdjacentHTML(
      "beforeend",
      card(
        "Notas dos dados",
        `<ul class="data-notes">${warnings.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`,
      ),
    );
  document.title = `${page === "dashboard" ? "Dashboard" : page === "campaigns" ? "Campanhas" : "Despesas"} — Cortex VPL Server`;
}
function toast(message: string) {
  document.querySelector("#cortex-toast")!.textContent = message;
  setTimeout(() => {
    document.querySelector("#cortex-toast")!.textContent = "";
  }, 4000);
}
async function save(next: CortexData) {
  try {
    await cortexData.save(next);
    data = next;
    render();
    toast("Alteração guardada na demonstração.");
    return true;
  } catch {
    toast(
      "Não foi possível guardar. Verifica o armazenamento do navegador e tenta novamente.",
    );
    return false;
  }
}
function field(
  label: string,
  name: string,
  value = "",
  type = "text",
  extra = "",
) {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function modal(
  title: string,
  fields: string,
  submit: (values: FormData) => Promise<boolean>,
) {
  dialog.innerHTML = `<form id="dialog-form"><header><h2 id="dialog-title">${title}</h2><button type="button" data-close aria-label="Fechar">×</button></header><div class="form-grid">${fields}</div><p class="form-error" role="alert"></p><footer><button type="button" data-close>Cancelar</button><button class="accent" type="submit">Guardar</button></footer></form>`;
  dialog.showModal();
  dialog
    .querySelectorAll("[data-close]")
    .forEach((b) => b.addEventListener("click", () => dialog.close()));
  dialog.querySelector("form")!.onsubmit = async (e) => {
    e.preventDefault();
    const b = dialog.querySelector<HTMLButtonElement>('[type="submit"]')!;
    b.disabled = true;
    try {
      if (await submit(new FormData(e.target as HTMLFormElement)))
        dialog.close();
    } catch (error) {
      dialog.querySelector(".form-error")!.textContent =
        error instanceof Error
          ? error.message
          : "Não foi possível guardar. Revê os valores e tenta novamente.";
    } finally {
      b.disabled = false;
    }
  };
}

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json()) as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(body.error || body.message || "Não foi possível guardar os dados.");
  return body;
}

async function loadProductOptions() {
  const result = await apiRequest<{ products: ProductOption[] }>("/api/products");
  availableProducts = result.products;
}

function productForm() {
  modal(
    "Novo Produto",
    field("Nome do produto", "name", "", "text", 'required maxlength="100"') +
      field("Shopify Product ID", "shopify_product_id", "", "text", 'required placeholder="15920136061305"') +
      field("URL do fornecedor", "supplier_url", "", "url", "required") +
      field("Custo unitário (€)", "unit_cost_eur", "0", "number", 'required min="0" step=".0001"') +
      field("Shipping por defeito (€)", "default_shipping_eur", "0", "number", 'required min="0" step=".0001"') +
      '<label>Estado<select name="status"><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>' +
      '<label>Imagem do produto (opcional)<input name="image" type="file" accept="image/*"></label>',
    async (form) => {
      const result = await apiRequest<{ product: ProductOption }>("/api/products", {
        method: "POST",
        body: form,
      });
      availableProducts.push(result.product);
      toast("Produto criado com sucesso.");
      return true;
    },
  );
}

async function newCampaignForm() {
  await loadProductOptions();
  if (!availableProducts.length) {
    toast("Cria primeiro um produto para poderes criar uma campanha.");
    return;
  }
  const productOptions = availableProducts
    .map((product) => `<option value="${esc(product.id)}">${esc(product.name)}</option>`)
    .join("");

  modal(
    "Nova Campanha",
    `<label>Produto<select name="productId" required>${productOptions}</select></label>` +
      field("Nome da campanha", "name", "", "text", 'required maxlength="100"') +
      field("ID externo da campanha (opcional)", "external_campaign_id", "", "text", 'maxlength="100"') +
      field("URL do funil", "funnel_url", "", "url", "required") +
      field("Data de início", "started_on", to, "date", "required") +
      field("Orçamento diário (€)", "daily_budget_eur", "0", "number", 'required min="0" step=".01"') +
      '<label>Estado<select name="status"><option value="active">Ativa</option><option value="planned">Planeada</option></select></label>',
    async (form) => {
      await apiRequest("/api/campaigns/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: String(form.get("productId")),
          name: String(form.get("name")).trim(),
          external_campaign_id: String(form.get("external_campaign_id")).trim(),
          funnel_url: String(form.get("funnel_url")).trim(),
          started_on: String(form.get("started_on")),
          daily_budget_eur: Number(form.get("daily_budget_eur")),
          status: String(form.get("status")),
        }),
      });
      toast("Campanha criada com sucesso.");
      void load();
      return true;
    },
  );
}

function importShopifyOrdersForm() {
  const defaultDate = data.asOf || to;
  modal(
    "Importar orders do Shopify",
    field("De", "from", defaultDate, "date", "required") +
      field("Até", "to", defaultDate, "date", "required") +
      '<p class="section-note">As orders são importadas para a base de dados e atribuídas às campanhas pelo Shopify Product ID. As páginas seguintes são carregadas automaticamente.</p>',
    async (form) => {
      const start = String(form.get("from"));
      const end = String(form.get("to"));
      if (!start || !end || start > end)
        throw new Error("Seleciona um intervalo de datas válido.");

      let after = "";
      let imported = 0;
      let pages = 0;
      do {
        const query = new URLSearchParams({ from: start, to: end });
        if (after) query.set("after", after);
        const result = await apiRequest<{
          ShopifyOrders?: unknown[];
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        }>(`/api/shopify/orders?${query.toString()}`);
        imported += result.ShopifyOrders?.length ?? 0;
        pages += 1;
        after = result.pageInfo?.hasNextPage
          ? String(result.pageInfo.endCursor || "")
          : "";
        if (pages >= 100 && after)
          throw new Error("A importação excedeu 100 páginas. Reduz o intervalo de datas.");
      } while (after);

      toast(`${imported} orders processadas e guardadas.`);
      await load();
      return true;
    },
  );
  dialog.querySelector<HTMLButtonElement>('[type="submit"]')!.textContent =
    "Importar orders";
}

function dailyStatusForm(c: Campaign) {
  const defaultDate = data.asOf || to;
  modal(
    `Fechar dia · ${c.name}`,
    field("Data", "date", defaultDate, "date", `required min="${c.start}"`) +
      field(
        "Ad Spend (€)",
        "ad_spent_eur",
        "0",
        "number",
        'required min="0" max="100000000" step=".01"',
      ) +
      '<p class="section-note">O servidor usa as orders já atribuídas a esta campanha para calcular Revenue, COGS, Profit, ROAS e a média dos últimos três dias.</p>',
    async (form) => {
      const result = await apiRequest<{
        dailyMetrics?: { revenue_eur?: number; profit_eur?: number; roas?: number };
      }>("/api/campaigns/dailystatus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: c.id,
          date: String(form.get("date")),
          ad_spent_eur: Number(form.get("ad_spent_eur")),
        }),
      });
      const metrics = result.dailyMetrics;
      toast(
        metrics
          ? `Daily Status guardado · Revenue ${money(Number(metrics.revenue_eur || 0))} · Profit ${money(Number(metrics.profit_eur || 0))}`
          : "Daily Status guardado com sucesso.",
      );
      await load();
      return true;
    },
  );
  dialog.querySelector<HTMLButtonElement>('[type="submit"]')!.textContent =
    "Calcular e guardar";
}

function campaignForm(c?: Campaign) {
  modal(
    c ? "Editar Campanha" : "Nova Campanha",
    field("Produto", "product", c?.product, "text", 'required maxlength="80"') +
      field("Loja", "store", c?.store, "text", 'required maxlength="80"') +
      field(
        "Nome da campanha",
        "name",
        c?.name,
        "text",
        'required maxlength="120"',
      ) +
      field("Data de início", "start", c?.start || to, "date", "required") +
      field(
        "Orçamento diário (€)",
        "budget",
        String(c?.budget ?? 50),
        "number",
        'required min="0" max="100000000" step=".01"',
      ) +
      field("URL do funil", "url", c?.url, "url"),
    async (f) => {
      const next = structuredClone(data);
      const values = {
        product: String(f.get("product")).trim(),
        store: String(f.get("store")).trim(),
        name: String(f.get("name")).trim(),
        start: String(f.get("start")),
        budget: Number(f.get("budget")),
        url: String(f.get("url")),
      };
      if (!values.product || !values.store || !values.name) return false;
      if (c) {
        const item = next.campaigns.find((x) => x.id === c.id)!;
        if (item.budget !== values.budget)
          item.history.unshift({
            date: new Date().toISOString(),
            before: item.budget,
            after: values.budget,
          });
        Object.assign(item, values);
      } else {
        selected = crypto.randomUUID();
        next.campaigns.push({
          id: selected,
          ...values,
          status: "Active",
          color: "purple",
          orders: [],
          spend: [],
          history: [],
        });
      }
      return save(next);
    },
  );
}
function expenseForm(e?: Expense) {
  modal(
    e ? "Editar Despesa" : "Nova Despesa",
    field("Nome", "name", e?.name, "text", 'required maxlength="100"') +
      field(
        "Fornecedor",
        "provider",
        e?.provider,
        "text",
        'required maxlength="80"',
      ) +
      field(
        "Categoria",
        "category",
        e?.category,
        "text",
        'required maxlength="80"',
      ) +
      field(
        "Valor (€)",
        "amount",
        String(e?.amount ?? 0),
        "number",
        'required min="0" max="100000000" step=".01"',
      ) +
      field("Data", "date", e?.date || to, "date", "required") +
      `<label>Tipo<select name="type"><option value="One-time">Pontual</option><option value="Subscription" ${e?.type === "Subscription" ? "selected" : ""}>Subscrição</option></select></label><div class="subscription-fields"><label>Frequência<select name="frequency"><option value="Monthly">Mensal</option><option value="Yearly" ${e?.frequency === "Yearly" ? "selected" : ""}>Anual</option></select></label></div>`,
    async (f) => {
      const selectedType = String(f.get("type"));
      const selectedFrequency = String(f.get("frequency") || "Monthly");
      if (data.source) {
        await apiRequest(e ? `/api/expenses/${encodeURIComponent(e.id)}` : "/api/expenses", {
          method: e ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: String(f.get("name")).trim(),
            provider: String(f.get("provider")).trim(),
            category: String(f.get("category")).trim(),
            amount_eur: Number(f.get("amount")),
            date: String(f.get("date")),
            type: selectedType === "Subscription" ? "subscription" : "one_time",
            frequency:
              selectedType === "Subscription"
                ? selectedFrequency === "Yearly"
                  ? "yearly"
                  : "monthly"
                : null,
          }),
        });
        toast(e ? "Despesa atualizada com sucesso." : "Despesa criada com sucesso.");
        await load();
        return true;
      }

      const next = structuredClone(data);
      const v = {
        id: e?.id || crypto.randomUUID(),
        name: String(f.get("name")).trim(),
        provider: String(f.get("provider")).trim(),
        category: String(f.get("category")).trim(),
        amount: Number(f.get("amount")),
        date: String(f.get("date")),
        type: selectedType as Expense["type"],
        frequency: selectedFrequency as Expense["frequency"],
        nextBilling: "",
        status: e?.status || "active",
      };
      if (!v.name || !v.provider || !v.category) return false;
      if (e) next.expenses[next.expenses.findIndex((x) => x.id === e.id)] = v;
      else next.expenses.push(v);
      return save(next);
    },
  );
  const select = dialog.querySelector<HTMLSelectElement>('[name="type"]')!;
  const toggle = () => {
    const sub = select.value === "Subscription";
    dialog.querySelector<HTMLElement>(".subscription-fields")!.hidden = !sub;
    dialog
      .querySelectorAll<HTMLSelectElement>(".subscription-fields select")
      .forEach((i) => (i.disabled = !sub));
  };
  select.onchange = toggle;
  toggle();
}
root.addEventListener("click", async (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>(
    "[data-action],[data-tab]",
  );
  if (!el) return;
  if (el.dataset.tab) {
    tab = el.dataset.tab;
    render();
    document.querySelector<HTMLElement>(`#tab-${tab}`)?.focus();
    return;
  }
  const c = data?.campaigns.find((c) => c.id === selected),
    action = el.dataset.action,
    id = el.dataset.id;
  if (action === "retry" || action === "refresh") {
    void load();
    return;
  }
  if (action === "select") {
    selected = id!;
    history.pushState({}, "", `/campaigns/${selected}${demoQuery()}`);
    render();
  }
  if (action === "new-product") productForm();
  if (action === "new-campaign") await newCampaignForm();
  if (action === "import-orders") importShopifyOrdersForm();
  if (action === "deactivate-campaign" && c) {
    if (!confirm(`Desativar a campanha ${c.name}?`)) return;
    await apiRequest(`/api/campaigns/${encodeURIComponent(c.id)}/deactivate`, {
      method: "PATCH",
    });
    toast("Campanha desativada.");
    await load();
  }
  if (action === "edit-campaign" && c) campaignForm(c);
  if (action === "orders") {
    tab = "orders";
    render();
  }
  if (action === "new-expense") expenseForm();
  if (action === "edit-expense")
    expenseForm(data.expenses.find((e) => e.id === id));
  if (action === "deactivate-expense") {
    const expense = data.expenses.find((e) => e.id === id)!;
    modal(
      "Desativar subscrição",
      `<p>Desativar “${esc(expense.name)}”? A despesa permanece no histórico, mas deixa de contar como cobrança futura.</p>`,
      async () => {
        if (data.source) {
          await apiRequest(`/api/expenses/${encodeURIComponent(expense.id)}/deactivate`, {
            method: "PATCH",
          });
          toast("Subscrição desativada.");
          await load();
          return true;
        }
        const next = structuredClone(data);
        next.expenses.find((item) => item.id === expense.id)!.status = "cancelled";
        return save(next);
      },
    );
    dialog.querySelector('[type="submit"]')!.textContent = "Desativar";
  }
  if (action === "edit-order" && c) {
    const o = c.orders.find((o) => o.id === id)!;
    modal(
      "Editar custos da encomenda",
      field(
        "Custo total dos produtos (€)",
        "productCost",
        o.productCost.toFixed(2),
        "number",
        'required min="0" max="100000000" step=".01"',
      ) +
        field(
          "Transporte (€)",
          "shipping",
          o.shipping.toFixed(2),
          "number",
          'required min="0" max="100000000" step=".01"',
        ),
      async (f) => {
        const next = structuredClone(data),
          order = next.campaigns
            .find((x) => x.id === c.id)!
            .orders.find((x) => x.id === id)!;
        order.productCost = Number(f.get("productCost"));
        order.shipping = Number(f.get("shipping"));
        return save(next);
      },
    );
  }
  if (action === "edit-budget" && c)
    modal(
      "Editar orçamento diário",
      field(
        "Novo orçamento (€)",
        "budget",
        String(c.budget),
        "number",
        'required min="0" max="100000000" step=".01"',
      ),
      async (f) => {
        const next = structuredClone(data),
          item = next.campaigns.find((x) => x.id === c.id)!;
        item.history.unshift({
          date: new Date().toISOString(),
          before: item.budget,
          after: Number(f.get("budget")),
        });
        item.budget = Number(f.get("budget"));
        return save(next);
      },
    );
  if (action === "add-spend" && c && data.source) dailyStatusForm(c);
  if (action === "add-spend" && c && !data.source)
    modal(
      "Registar investimento diário",
      field("Data", "date", to, "date", `required min="${c.start}"`) +
        field(
          "Ad Spend (€)",
          "amount",
          "0",
          "number",
          'required min="0" max="100000000" step=".01"',
        ),
      async (f) => {
        const next = structuredClone(data),
          item = next.campaigns.find((x) => x.id === c.id)!,
          d = String(f.get("date"));
        item.spend = item.spend.filter((s) => s.date !== d);
        item.spend.push({ date: d, amount: Number(f.get("amount")) });
        return save(next);
      },
    );
});
root.addEventListener("change", async (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === "date-from" || el.id === "date-to") {
    const a = (document.querySelector("#date-from") as HTMLInputElement).value,
      b = (document.querySelector("#date-to") as HTMLInputElement).value;
    if (!a || !b || a > b) {
      toast("Seleciona um intervalo de datas válido.");
      el.value = el.id === "date-from" ? from : to;
      return;
    }
    from = a;
    to = b;
    render();
  }
  if (el.id === "status-filter") {
    status = el.value;
    render();
  }
  if (el.id === "campaign-status") {
    const next = structuredClone(data);
    next.campaigns.find((c) => c.id === selected)!.status = el.value as Status;
    await save(next);
  }
});
root.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === "campaign-search") {
    search = el.value;
    const pos = el.selectionStart;
    render();
    const input = document.querySelector<HTMLInputElement>("#campaign-search")!;
    input.focus();
    if (pos !== null) input.setSelectionRange(pos, pos);
  }
});
root.addEventListener("submit", async (e) => {
  const form = e.target as HTMLFormElement;
  if (!form.dataset.spend) return;
  e.preventDefault();
  const next = structuredClone(data),
    c = next.campaigns.find((c) => c.id === selected)!;
  c.spend = c.spend.filter((d) => d.date !== form.dataset.spend);
  c.spend.push({
    date: form.dataset.spend,
    amount: Number(new FormData(form).get("amount")),
  });
  await save(next);
});
root.addEventListener("keydown", (e) => {
  const el = e.target as HTMLElement;
  if (
    el.getAttribute("role") === "tab" &&
    ["ArrowLeft", "ArrowRight"].includes(e.key)
  ) {
    e.preventDefault();
    const tabs = ["overview", "orders", "daily", "budget"];
    tab = tabs[(tabs.indexOf(tab) + (e.key === "ArrowRight" ? 1 : 3)) % 4];
    render();
    document.querySelector<HTMLElement>(`#tab-${tab}`)?.focus();
  }
});
async function load() {
  root.innerHTML =
    '<p class="empty-state" role="status">A carregar o teu workspace…</p>';
  try {
    data = await cortexData.load();
    if (!initialized && data.source) {
      from = data.campaigns.map((c) => c.start).sort()[0] || data.asOf!;
      to = data.asOf!;
      initialized = true;
    }
    const requested = location.pathname.split("/")[2];
    if (requested && data.source) {
      const campaign = data.campaigns.find((item) => item.id === requested);
      if (!campaign) throw new Error("Campanha não encontrada.");
      selected = requested;
      if (status !== 'all' && status !== campaign.status) status = campaign.status;
    }
    render();
    if (
      !data.readOnly &&
      page === "campaigns" &&
      new URLSearchParams(location.search).has("new")
    )
      campaignForm();
  } catch (error) {
    root.innerHTML = card(
      "Não foi possível carregar os dados",
      `<p class="section-note">${esc((error as Error).message)}</p>${button("retry", "Tentar novamente", "accent")}`,
    );
  }
}
void load();

window.addEventListener("popstate", () => {
  selected = location.pathname.split("/")[2] || "";
  void load();
});
