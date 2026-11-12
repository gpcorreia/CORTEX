export {};
const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const labels: Record<string, string> = {
  running: "Em execução",
  pending_validation: "Aguarda validação",
  needs_attention: "Precisa de atenção",
  ready: "Pronto para iniciar",
  awaiting_implementation: "Etapas futuras",
  completed: "Concluído",
  skipped: "Dispensado",
  planned: "Por implementar",
  blocked: "Bloqueado",
  failed: "Erro",
};
function badge(status: string) {
  return `<span class="wf-badge wf-${escape(status)}">${escape(labels[status] ?? status)}</span>`;
}
const id = /^\/workflows\/([a-f0-9]{24})\/?$/.exec(location.pathname)?.[1];
let items: any[] = [],
  page = 1,
  busy = false,
  timer: ReturnType<typeof setTimeout> | undefined;
async function api(url: string, body?: unknown) {
  const response = await fetch(
    url,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) throw Error(data.error ?? "Pedido falhou.");
  return data;
}
function renderList() {
  const search = el<HTMLInputElement>("search").value.toLowerCase(),
    filter = el<HTMLSelectElement>("filter").value;
  const filtered = items.filter(
    (w) =>
      w.productName.toLowerCase().includes(search) &&
      (filter === "all" || w.status === filter),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  page = Math.min(page, pages);
  el("metrics").innerHTML = [
    ["Em execução", items.filter((w) => w.status === "running").length],
    [
      "Aguarda validação",
      items.filter((w) => w.status === "pending_validation").length,
    ],
    ["Total de workflows", items.length],
  ]
    .map(
      ([label, value]) =>
        `<div class="wf-card"><p class="text-sm text-slate-500">${label}</p><p class="text-3xl font-semibold mt-2">${value}</p></div>`,
    )
    .join("");
  el("content").innerHTML = filtered.length
    ? `<div class="wf-card !p-0">${filtered
        .slice((page - 1) * 20, page * 20)
        .map(
          (w) =>
            `<a class="wf-list-row" href="/workflows/${escape(w.id)}"><div><h2 class="font-semibold">${escape(w.productName)}</h2><p class="text-xs text-slate-500 mt-1">${escape(w.locale)} · ${escape(w.currentStep)}</p></div><div>${badge(w.status)}</div><div class="text-xs text-slate-500">${w.progress}% <span class="ml-3 text-teal-700">Abrir →</span></div></a>`,
        )
        .join("")}</div>`
    : '<div class="wf-card text-center text-slate-500 py-12">Nenhum workflow encontrado. Guarda os inputs de um produto para começar.</div>';
  el("range").textContent = filtered.length
    ? `${(page - 1) * 20 + 1}–${Math.min(page * 20, filtered.length)} de ${filtered.length}`
    : "0 workflows";
  el<HTMLButtonElement>("previous").disabled = page === 1;
  el<HTMLButtonElement>("next").disabled = page === pages;
}
function action(name: string, label: string, style = "primary") {
  return `<button type="button" data-action="${name}" class="${style} text-sm">${label}</button>`;
}
function renderDetail(w: any) {
  el("heading").textContent = w.productName;
  el("subtitle").textContent =
    `${w.locale} · ${w.currency} · ${w.createBrand ? "Com branding" : "Sem branding"}`;
  const b = w.brand;
  const busyBrand = [
    "queued",
    "generating_names",
    "preparing",
    "adapting",
  ].includes(b?.status);
  const preview = (kind: string, label: string) =>
    `<figure><div class="alpha-preview"><img src="/api/workflows/${id}/artifacts/${kind}?revision=${b.revision}" alt="${label}" class="w-full h-60 object-contain p-5"></div><figcaption class="text-xs text-slate-500 mt-2">${label}</figcaption></figure>`;
  el("content").innerHTML =
    `<div class="flex flex-wrap items-center gap-3 mb-5">${badge(w.status)}<span class="text-xs text-slate-500">${w.progress}% do percurso · sem execução automática das etapas futuras</span><a class="text-sm text-teal-700 ml-auto" href="/?prepare=${id}">Editar parâmetros</a></div>
<div class="wf-graph" aria-label="Sessões do workflow">${w.stages.map((s: any) => `<div class="wf-node wf-node-${s.status}"><span class="wf-number">${s.id}</span><h2 class="font-semibold text-sm mt-3">${escape(s.name)}</h2><span class="text-xs text-slate-500 block mt-2">${escape(labels[s.status] ?? s.status)}</span></div>`).join("")}</div>
${w.inputError ? `<div class="wf-card border-amber-300 my-5"><p>${escape(w.inputError)}</p><a href="/?prepare=${id}" class="text-teal-700 underline text-sm">Corrigir os inputs</a></div>` : ""}
<div class="grid gap-5 mt-6"><section class="wf-card"><div class="flex flex-wrap items-center justify-between gap-3"><h2 class="font-semibold text-lg">2 · Download e seleção</h2>${badge(w.stages[1].status)}</div><p class="text-sm text-slate-500 mt-3">${escape(w.media?.summary ?? "Inicia a recolha. Este passo não usa IA.")}</p>
${w.projectPath ? `<p class="text-xs text-slate-500 mt-4 break-all">${escape(w.projectPath)}</p><div class="grid md:grid-cols-2 gap-3 mt-4"><div class="rounded-lg bg-slate-50 p-4"><p class="text-sm font-medium">Advertorial</p><p class="text-xs text-slate-500 mt-1">copy → generator</p></div><div class="rounded-lg bg-slate-50 p-4"><p class="text-sm font-medium">Sales page · content</p><p class="text-xs text-slate-500 mt-1">copy → generator</p></div></div>` : ""}
${w.media?.limitations?.length ? `<details class="text-sm mt-4 text-amber-800"><summary>${w.media.limitations.length} fontes com falhas</summary><ul class="mt-2 space-y-2 break-all">${w.media.limitations.map((n: string) => `<li>${escape(n)}</li>`).join("")}</ul></details>` : ""}
<div class="flex flex-wrap gap-3 mt-5">${!w.media || w.media.status === "failed" || w.media.inputsChanged ? action("start", "Iniciar download") : ""}${w.media && w.media.status !== "running" && !busyBrand && !b?.approvedAt ? action("rescan", "Procurar imagens em falta", "secondary") : ""}</div>
${w.media?.status === "awaiting_review" && !w.media.inputsChanged ? `<div class="rounded-lg bg-amber-50 border border-amber-200 p-5 mt-5"><p class="font-medium text-sm">Pending validation</p><p class="text-sm text-slate-600 mt-2">${w.createBrand ? "Coloca as imagens a editar em advertorial/generator e content/generator. Coloca uma imagem estática do produto ou das bundles do concorrente na pasta brand para servir de referência ao product master." : "Confirma os downloads. Sem branding, as imagens e o produto são mantidos sem IA."}</p><p class="text-xs text-slate-500 mt-2">${w.selectionCount} imagens nas pastas generator. Atualiza após organizar os ficheiros.</p><div class="mt-4">${action("validate", w.createBrand ? "Validar seleção e ver marcas" : "OK — confirmar downloads")}</div></div>` : ""}</section>
<section class="wf-card"><div class="flex flex-wrap justify-between items-center gap-3"><h2 class="font-semibold text-lg">3 · Branding e imagens</h2>${badge(w.stages[2].status)}</div><p class="text-sm text-slate-500 mt-3">${escape(w.stages[2].description)}</p>
${w.createBrand && !busyBrand && !b?.approvedAt && !(b?.status === "failed" && b?.brandName) && !w.media?.inputsChanged && ["awaiting_review", "approved"].includes(w.media?.status) ? `<div class="rounded-lg border border-slate-200 bg-slate-50 p-5 mt-5"><label for="custom-brand-name" class="label">Já escolheste o nome da marca?</label><p class="text-sm text-slate-500 mt-2">Escreve uma palavra fácil de pronunciar. Guardar o nome não usa IA nem pede sugestões.</p><input id="custom-brand-name" class="field w-full mt-3" maxlength="44" autocomplete="off" placeholder="Ex.: Artroviva" value="${escape(b?.nameSource === "user" ? b.brandName : "")}"><div class="mt-3"><button type="button" class="secondary text-sm" data-action="custom-name" data-validate="${w.media.status === "awaiting_review"}">Guardar nome (sem IA)</button></div>${b?.status === "awaiting_brand_creation" ? `<p class="font-medium mt-4">Nome escolhido: ${escape(b.brandName)}™</p><p class="text-sm text-slate-500 mt-2">Indica os packs que queres apresentar. O servidor pedirá o logo e o product master à IA e comporá estas bundles a partir do master marcado.</p><label for="quantities" class="label mt-4">Quantidades das bundles</label><input id="quantities" class="field w-full" placeholder="Ex.: 1, 2, 3" value="${escape(b.bundleQuantities?.join(", ") ?? "")}"><div class="mt-3">${action("create-brand", "Criar logo, master e bundles")}</div>` : ""}</div>` : ""}
${b?.status === "failed" && b?.brandName && !b?.approvedAt && !w.brandInputsChanged ? `<div class="rounded-lg border border-amber-200 bg-amber-50 p-5 mt-5"><p class="font-medium">A marca escolhida foi preservada: ${escape(b.brandName)}™</p><p class="text-sm text-slate-600 mt-2">A criação dos ficheiros falhou, mas não precisas de escolher a marca novamente.</p><div class="mt-4">${action("reset-branding", "Recuperar esta marca", "secondary")}</div></div>` : ""}
${b?.usage ? `<p class="text-xs text-slate-500 mt-3">Subscrição · ${b.usage.inputTokens.toLocaleString("pt-PT")} tokens de entrada · ${b.usage.outputTokens.toLocaleString("pt-PT")} de saída</p>` : ""}
${b?.status === "awaiting_name_choice" && !w.brandInputsChanged ? `<div class="mt-5"><h3 class="font-semibold">Escolhe a marca</h3><p class="text-sm text-slate-500 mt-2">A escolha apenas guarda o nome. No passo seguinte indicas as quantidades antes de criar o logo, o product master e as bundles.</p><div class="grid md:grid-cols-3 gap-4 mt-4">${(b.nameOptions ?? []).map((option: any) => `<article class="rounded-lg border border-slate-200 p-5"><p class="text-xs text-teal-700">${option.kind === "product_adaptation" ? "Adaptação do nome do produto" : "Nome relacionado com o produto"}</p><h4 class="text-xl font-semibold mt-3">${escape(option.name)}™</h4><p class="text-sm text-slate-500 mt-2">${escape(option.reason)}</p><button type="button" class="primary text-sm mt-4" data-action="choose-name" data-option-id="${escape(option.id)}">Escolher esta marca</button></article>`).join("")}</div></div>` : ""}
${b?.qualityWarning ? `<div class="bg-amber-50 border border-amber-200 rounded-lg p-5 mt-5"><p class="font-medium">A IA assinalou problemas de qualidade</p><p class="text-sm mt-2">Consulta as notas e revê o logo e o produto. A aprovação usa estes ficheiros mesmo com os problemas indicados.</p></div>` : ""}
${b?.status === "failed" && b?.draftAvailable && !w.brandInputsChanged ? `<div class="mt-4">${action("review-draft", "Rever logo e produto guardados", "secondary")}<p class="text-xs text-slate-500 mt-2">Abre os ficheiros para aprovação, sem voltar a gerar imagens.</p></div>` : ""}
${b?.logo && b?.master ? `<h3 class="font-semibold mt-5">${escape(b.brandName)}™</h3><div class="grid sm:grid-cols-2 gap-5 mt-4">${preview("logo", "Logo")}${preview("master", "Produto master")}</div>` : ""}
${b?.status === "awaiting_approval" && !w.brandInputsChanged ? `<div class="bg-amber-50 border border-amber-200 rounded-lg p-5 mt-5"><h3 class="font-medium">Aprovação do logo, master e bundles</h3><p class="text-sm text-slate-600 mt-2">Revê os artefactos acima. Só a tua aprovação permite ao servidor enviar toda a seleção do generator para uma única edição de IA.</p><input id="quantities" type="hidden" value="${escape(b.bundleQuantities.join(", "))}"><div class="mt-4">${action("approve-brand", "Aprovar e iniciar Media")}</div></div>` : ""}
${["failed", "needs_attention"].includes(b?.status) && b?.mode !== "batch" ? `<div class="mt-4">${b.approvedAt ? action("retry-adaptations", "Retomar apenas as imagens pendentes", "secondary") : b.brandName ? "" : action("retry-brand", "Ver três opções de marca", "secondary")}</div>` : ""}
${w.media?.status === "approved" && w.createBrand && (!b || w.brandInputsChanged) ? `<div class="mt-4">${action("validate", "Validar seleção e ver marcas")}</div>` : ""}
${b?.bundles?.length ? `<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">${b.bundles.map((pack: any) => preview("pack-" + pack.quantity, `${pack.quantity} unidade(s)`)).join("")}</div>` : ""}
${
  b?.selection?.length && b.approvedAt
    ? `<div class="mt-5"><h3 class="font-medium">Aplicação às imagens · ${b.selection.filter((a: any) => a.status === "completed").length}/${b.selection.length}</h3><p class="text-xs text-slate-500 mt-2">Imagens estáticas primeiro; GIFs e WebP animados no fim. A retoma reutiliza os resultados concluídos.</p><ul class="mt-3 space-y-3 text-sm">${[
        ...b.selection,
      ]
        .sort((a: any, c: any) => Number(a.animated) - Number(c.animated))
        .map(
          (a: any) =>
            `<li class="break-all"><span class="font-medium">${escape(a.path.split("/").pop())}</span> · ${a.animated ? "Animação" : "Imagem"} · ${a.status === "completed" ? "Concluída" : "Pendente"}${a.error ? `<p class="text-xs text-amber-800 mt-1">${escape(a.error)}</p>` : ""}</li>`,
        )
        .join("")}</ul></div>`
    : ""
}
${b?.notes?.length ? `<details class="mt-4 text-sm text-slate-500"><summary>Notas e limitações</summary><ul class="space-y-2 mt-3">${b.notes.map((n: string) => `<li>${escape(n)}</li>`).join("")}</ul></details>` : ""}
</section>${translationPanel(w)}<section class="wf-card"><h2 class="font-semibold">Transferência para Funnelish</h2><p class="text-sm text-slate-500 mt-2">Por implementar. Só ficará pronta para a próxima etapa depois da tua aprovação na sessão Translation.</p></section></div>`;
}
function translationPanel(w: any) {
  const info = w.translation,
    state = info?.state,
    enabled = w.media?.status === "approved" && !w.media?.inputsChanged,
    brandingIncomplete =
      w.createBrand && w.brand?.status !== "completed";
  return `<section class="wf-card"><div class="flex flex-wrap justify-between gap-3"><h2 class="font-semibold text-lg">4 · Translation e revisão local</h2>${badge(w.stages.find((s: any) => s.id === 4)?.status ?? "blocked")}</div>
  <p class="text-sm text-slate-500 mt-3">${escape(info?.inputError || state?.message || "Tradução integral dos textos das duas páginas, com reconstrução local da estrutura recolhida.")}</p>
  ${enabled && brandingIncomplete ? `<div class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4"><p class="text-sm font-medium text-amber-900">Brand & Media ainda não está concluído.</p><p class="text-sm text-amber-800 mt-1">Podes avançar com a tradução. Imagens pendentes podem ficar vazias na versão local e não bloqueiam o texto.</p></div>` : ""}
  <p class="text-xs text-slate-500 mt-3">${info?.capturedPages ?? 0} páginas recolhidas · ${info?.textBlocks ?? 0} blocos · ${(info?.characters ?? 0).toLocaleString("pt-PT")} caracteres. A IA recebe apenas texto; blocos repetidos e concluídos são reutilizados.</p>
  ${state ? `<p class="text-xs text-slate-500 mt-2">${state.translatedBlocks}/${state.uniqueBlocks} blocos únicos concluídos · ${state.cachedBlocks} reutilizados${state.usage ? ` · ${state.usage.inputTokens.toLocaleString("pt-PT")} tokens de entrada · ${state.usage.outputTokens.toLocaleString("pt-PT")} de saída` : ""}</p>` : ""}
  ${enabled && ((info?.capturedPages ?? 0) < (w.competitorCount ?? 1) * 2 || info?.inputError?.includes("Falta a estrutura")) ? `<div class="mt-4">${action("collect-funnel", "Recolher estrutura em falta (sem IA)", "secondary")}</div>` : ""}
  ${enabled && !info?.inputError && (info?.stale || !state || state.status === "failed") ? `<div class="mt-4">${action("translate-site", state?.status === "failed" ? "Retomar tradução pendente" : "Estou pronto — iniciar tradução")}</div>` : ""}
  ${
    state &&
    !info?.stale &&
    ["awaiting_review", "completed"].includes(state.status)
      ? `<div class="mt-5 space-y-5">${state.pages
          .map((p: any) => {
            const frameId = `preview-${p.competitor}-${p.page}`;
            const url = `/api/workflows/${id}/translation/preview/${p.competitor}/${p.page}`;
            return `<details class="rounded-lg border border-slate-200 p-4"><summary class="font-medium">Concorrente ${p.competitor} · ${p.page === "content" ? "Sales page" : "Advertorial"}</summary><div class="flex flex-wrap gap-3 my-4"><button class="secondary text-sm" data-action="preview-width" data-frame="${frameId}" data-width="100%">Desktop</button><button class="secondary text-sm" data-action="preview-width" data-frame="${frameId}" data-width="390px">Mobile</button><a class="text-sm text-teal-700" href="${url}" target="_blank" rel="noopener">Abrir página</a></div><div class="overflow-auto w-full bg-slate-100"><iframe id="${frameId}" title="Concorrente ${p.competitor} ${p.page}" src="${url}" sandbox="" loading="lazy" style="width:100%;height:720px;border:0;background:white"></iframe></div></details>`;
          })
          .join("")}</div>`
      : ""
  }
  ${state?.notes?.length ? `<details class="mt-4 text-sm text-amber-800"><summary>Notas da tradução e limitações da versão local</summary><ul class="mt-2 space-y-2">${state.notes.map((n: string) => `<li class="break-all">${escape(n)}</li>`).join("")}</ul></details>` : ""}
  ${(state?.status === "awaiting_review" || info?.previewsChanged) && !info?.stale && !info?.inputError ? `<div class="mt-5">${action("approve-translation", "Aprovar tradução e versão local")}<p class="text-xs text-slate-500 mt-2">Confirma depois de rever advertorial e sales page em desktop e mobile. Não inicia transferência nem publica.</p></div>` : ""}
  </section>`;
}
async function load() {
  if (timer) clearTimeout(timer);
  if (busy) return;
  try {
    if (id) {
      const view = await api("/api/workflows/" + id);
      renderDetail(view);
      if (view.status === "running")
        timer = setTimeout(() => void load(), 2500);
    } else {
      items = (await api("/api/workflows")).workflows;
      renderList();
      timer = setTimeout(() => void load(), 5000);
    }
  } catch (e) {
    el("notice").textContent = (e as Error).message;
  }
}
el("refresh").onclick = () => void load();
el("search").oninput = () => {
  page = 1;
  renderList();
};
el("filter").onchange = () => {
  page = 1;
  renderList();
};
el("previous").onclick = () => {
  page--;
  renderList();
};
el("next").onclick = () => {
  page++;
  renderList();
};
el("content").onclick = async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-action]",
  );
  if (!button || !id || busy) return;
  const name = button.dataset.action;
  if (name === "preview-width") {
    el<HTMLIFrameElement>(button.dataset.frame!).style.width =
      button.dataset.width!;
    return;
  }
  let endpoint = "",
    body: unknown = {};
  if (name === "start") endpoint = "/start";
  if (name === "rescan") {
    endpoint = "legacy";
    body = { rescan: true };
  }
  if (name === "validate") endpoint = "/validate-media";
  if (name === "retry-brand") endpoint = "/branding/retry";
  if (name === "reset-branding") endpoint = "/branding/reset";
  if (name === "custom-name") {
    const field = el<HTMLInputElement>("custom-brand-name");
    if (!field.value.trim()) {
      el("notice").textContent = "Escreve o nome da marca.";
      field.focus();
      return;
    }
    endpoint =
      button.dataset.validate === "true"
        ? "/validate-media"
        : "/branding/custom-name";
    body = { brandName: field.value.trim() };
  }
  if (name === "create-brand") {
    endpoint = "/branding/create";
    const value = el<HTMLInputElement>("quantities").value;
    body = {
      quantities: value
        .split(/[\s,;]+/)
        .filter(Boolean)
        .map(Number),
    };
  }
  if (name === "review-draft") endpoint = "/branding/review-draft";
  if (name === "regenerate-names") endpoint = "/branding/regenerate-names";
  if (name === "choose-name") {
    endpoint = "/branding/choose-name";
    body = { optionId: button.dataset.optionId };
  }
  if (name === "retry-adaptations") endpoint = "/branding/retry-adaptations";
  if (name === "collect-funnel") endpoint = "/translation/collect";
  if (name === "translate-site") endpoint = "/translation/start";
  if (name === "approve-translation") endpoint = "/translation/approve";
  if (name === "approve-brand") {
    endpoint = "/branding/approve";
    const value = el<HTMLInputElement>("quantities").value;
    body = {
      quantities: value
        .split(/[\s,;]+/)
        .filter(Boolean)
        .map(Number),
    };
  }
  if (!endpoint) return;
  busy = true;
  button.disabled = true;
  el("notice").textContent = "";
  try {
    await api(
      endpoint === "legacy"
        ? `/api/workflow/${id}/download`
        : `/api/workflows/${id}${endpoint}`,
      body,
    );
  } catch (e) {
    el("notice").textContent = (e as Error).message;
  } finally {
    busy = false;
    await load();
  }
};
if (id) {
  el("list-tools").hidden = true;
  el("pagination").hidden = true;
  el("back").hidden = false;
}
void load();
