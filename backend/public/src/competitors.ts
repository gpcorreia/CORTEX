export {};
interface Competitor {
  domain: string;
  storeUrl: string;
  adsUrl: string;
  productCount: number;
}
const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let competitors: Competitor[] = [];
let page = 1;
const pageSize = 20;
function render() {
  const query = el<HTMLInputElement>("search").value.trim().toLowerCase();
  const filtered = competitors.filter((c) => c.domain.includes(query)).sort((a,b)=>
    el<HTMLSelectElement>('sort').value === 'products'
      ? b.productCount-a.productCount || a.domain.localeCompare(b.domain)
      : a.domain.localeCompare(b.domain));
  const pages = Math.max(1, Math.ceil(filtered.length/pageSize));
  page = Math.min(page,pages);
  const shown = filtered.slice((page-1)*pageSize,page*pageSize);
  const container = el("competitors");
  container.replaceChildren();
  for (const c of shown) {
    const card = document.createElement("article");
    card.className = "competitor-row";
    const title = document.createElement("h3");
    title.className = "font-medium text-sm break-words min-w-0";
    title.textContent = c.domain;
    const count = document.createElement("p");
    count.className = "text-xs text-slate-500";
    count.textContent = `${c.productCount} ${c.productCount === 1 ? "produto" : "produtos"}`;
    card.append(title, count);
    const actions = document.createElement('div');
    actions.className = 'flex items-center gap-4 text-sm';
    for (const [label, href] of [
      ["Abrir loja", c.storeUrl],
      ["Meta Ads Library ↗", c.adsUrl],
    ]) {
      const link = document.createElement("a");
      link.href = href;
      link.textContent = label;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "text-teal-700 hover:underline whitespace-nowrap";
      link.setAttribute('aria-label', `${label} — ${c.domain}`);
      actions.append(link);
    }
    card.append(actions);
    container.append(card);
  }
  el("count").textContent =
    `${competitors.length} domínios únicos${query ? ` · ${filtered.length} encontrados` : ''}`;
  el('range').textContent = filtered.length ? `${(page-1)*pageSize+1}–${Math.min(page*pageSize,filtered.length)} de ${filtered.length}` : '0 resultados';
  el('page').textContent = `Página ${page} de ${pages}`;
  el<HTMLButtonElement>('previous').disabled = page===1;
  el<HTMLButtonElement>('next').disabled = page===pages;
  el("empty").hidden = shown.length > 0;
}
async function refresh() {
  const button = el<HTMLButtonElement>("refresh");
  button.disabled = true;
  el("notice").textContent = "A ler a spreadsheet…";
  try {
    const response = await fetch("/api/research");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    competitors = data.competitors;
    render();
    el("notice").textContent =
      `Atualizado às ${new Date(data.syncedAt).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}.`;
  } catch (e) {
    el("notice").textContent = (e as Error).message;
  } finally {
    button.disabled = false;
  }
}
el("refresh").onclick = () => void refresh();
el("search").addEventListener("input", () => {page=1;render();});
el('sort').addEventListener('change',()=>{page=1;render();});
el('previous').onclick=()=>{page--;render();};
el('next').onclick=()=>{page++;render();};
void refresh();
