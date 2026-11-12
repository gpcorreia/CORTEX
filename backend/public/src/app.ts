interface Product {
  id: string;
  name: string;
  approved: boolean;
  tested: boolean;
  fields: Record<string, string>;
}
interface Inputs {
  competitors: CompetitorInput[];
  advertorialUrl?: string;
  salesPageUrl?: string;
  createBrand: boolean;
  sameProduct?: boolean;
  productImage: string | null;
  locale: string;
  currency: string;
}
interface CompetitorInput {
  advertorialUrl: string;
  salesPageUrl: string;
}
const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const dialog = el<HTMLDialogElement>("dialog"),
  form = el<HTMLFormElement>("inputs");
let products: Product[] = [],
  selected: Product | null = null,
  productImage: string | null = null,
  busy = false;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let inputsDirty = false;
function competitorValues(): CompetitorInput[] {
  return [
    ...form.querySelectorAll<HTMLFieldSetElement>("[data-competitor]"),
  ].map((group) => {
    const fields = group.querySelectorAll<HTMLInputElement>("input");
    return { advertorialUrl: fields[0].value, salesPageUrl: fields[1].value };
  });
}
function markDirty() {
  inputsDirty = true;
  el<HTMLButtonElement>("start-workflow").disabled = true;
}
function renderCompetitors(values: CompetitorInput[]) {
  el<HTMLInputElement>("advertorial").value = values[0].advertorialUrl;
  el<HTMLInputElement>("sales").value = values[0].salesPageUrl;
  const container = el("additional-competitors");
  container.replaceChildren();
  values.slice(1).forEach((value, i) => {
    const group = document.createElement("fieldset");
    group.dataset.competitor = "";
    group.className = "border border-slate-200 rounded-lg p-4 mb-4";
    const legend = document.createElement("legend");
    legend.className = "text-sm font-semibold px-1";
    legend.textContent = `Concorrente ${i + 2}`;
    group.append(legend);
    for (const [key, label] of [
      ["advertorialUrl", "Link do advertorial"],
      ["salesPageUrl", "Link da sales page"],
    ] as const) {
      const input = document.createElement("input");
      input.id = `${key}-${i + 2}`;
      input.type = "url";
      input.required = true;
      input.value = value[key];
      input.placeholder = "https://…";
      input.className = "field w-full mb-4";
      const title = document.createElement("label");
      title.htmlFor = input.id;
      title.className = "label";
      title.textContent = label;
      group.append(title, input);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remover concorrente";
    remove.className = "text-sm text-rose-700";
    remove.onclick = () => {
      const current = competitorValues();
      current.splice(i + 1, 1);
      renderCompetitors(current);
      markDirty();
    };
    group.append(remove);
    container.append(group);
  });
  el<HTMLButtonElement>("add-competitor").disabled = values.length >= 3;
}
el("add-competitor").onclick = () => {
  const values = competitorValues();
  if (values.length >= 3) return;
  values.push({ advertorialUrl: "", salesPageUrl: "" });
  renderCompetitors(values);
  markDirty();
};
async function loadWorkflow(id: string) {
  const view = await api("/api/workflows/" + id);
  if (selected?.id !== id || !dialog.open) return;
  el("workflow").hidden = false;
  const button = el<HTMLButtonElement>("start-workflow");
  button.disabled = inputsDirty || Boolean(view.inputError);
  button.textContent = view.media ? "Abrir workflow" : "Start workflow";
  message(
    "workflow-status",
    view.inputError ||
      "Parâmetros guardados. Podes iniciar agora ou voltar mais tarde.",
  );
}
function photoRequirement() {
  const branding = el<HTMLInputElement>("branding").checked;
  const same = el<HTMLInputElement>("same-product").checked;
  el("same-product-wrap").hidden = !branding;
  const required = branding && !same && !productImage;
  el<HTMLInputElement>("image").required = required;
  el("photo-requirement").textContent = branding && same
    ? "Opcional: usamos o produto do concorrente. Só alteramos a marca e o texto quando necessário."
    : branding
    ? "Obrigatória com branding"
    : "Opcional, sem branding";
}
async function api(url: string, options?: RequestInit) {
  const r = await fetch(url, options);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Pedido falhou.");
  return data;
}
function message(id: string, text: string) {
  el(id).textContent = text;
}
function safeLink(value: string) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
function render() {
  const search = el<HTMLInputElement>("search").value.toLowerCase(),
    filter = el<HTMLSelectElement>("filter").value;
  const shown = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search) &&
      (filter === "all" || (filter === "approved" ? p.approved : !p.approved)),
  );
  const body = el("products");
  body.replaceChildren();
  for (const p of shown) {
    const tr = document.createElement("tr");
    tr.className = "border-b border-slate-100";
    const cell = (text: string) => {
      const td = document.createElement("td");
      td.className = "p-4";
      td.textContent = text;
      tr.append(td);
      return td;
    };
    cell(p.name).classList.add("font-medium");
    const status = cell(p.approved ? "Aprovado" : "Sem aprovação");
    status.classList.add(p.approved ? "text-teal-700" : "text-slate-500");
    cell(p.tested ? "Sim" : "Não");
    const links = cell("");
    for (const [name, key] of [
      ["Anúncio", "Competitor ad link"],
      ["Loja", "Competitor store link"],
    ]) {
      const href = safeLink(p.fields[key]);
      if (href) {
        const a = document.createElement("a");
        a.href = href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = name;
        a.className = "text-teal-700 underline mr-3";
        links.append(a);
      }
    }
    const action = cell("");
    const button = document.createElement("button");
    button.textContent = p.approved ? "Preparar teste" : "Aguardar coach";
    button.className = "secondary whitespace-nowrap";
    button.disabled = !p.approved;
    button.onclick = () => void openProduct(p);
    action.append(button);
    body.append(tr);
  }
  el("empty").hidden = shown.length > 0;
  message(
    "count",
    `${products.length} produtos · ${products.filter((p) => p.approved).length} aprovados · ${shown.length} apresentados`,
  );
}
async function refresh() {
  const button = el<HTMLButtonElement>("refresh");
  button.disabled = true;
  message("notice", "A ler a spreadsheet…");
  try {
    const data = await api("/api/research");
    products = data.products;
    render();
    const prepare = new URLSearchParams(location.search).get("prepare");
    if (prepare && !selected) {
      const product = products.find((p) => p.id === prepare);
      if (product) {
        history.replaceState(null, "", location.pathname);
        void openProduct(product);
      }
    }
    message(
      "notice",
      `Atualizado às ${new Date(data.syncedAt).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}.`,
    );
  } catch (e) {
    message("notice", (e as Error).message);
  } finally {
    button.disabled = false;
  }
}
function showImage() {
  photoRequirement();
  el("image-wrap").hidden = !productImage;
  const img = el<HTMLImageElement>("preview");
  if (productImage) img.src = productImage;
  else img.removeAttribute("src");
}
async function openProduct(p: Product) {
  if (busy) return;
  selected = p;
  form.reset();
  renderCompetitors([{ advertorialUrl: "", salesPageUrl: "" }]);
  inputsDirty = false;
  if (pollTimer) clearTimeout(pollTimer);
  el("workflow").hidden = true;
  productImage = null;
  showImage();
  message("product-title", p.name);
  message("form-status", "A recuperar inputs guardados…");
  el<HTMLButtonElement>("save").disabled = true;
  dialog.showModal();
  try {
    const status = await api("/api/status");
    if (status.inputSchema !== 4)
      throw new Error(
        "O servidor está desatualizado. Não foram guardados inputs.",
      );
    const record = await api(`/api/inputs/${p.id}`);
    if (selected?.id !== p.id || !dialog.open) return;
    if (record) {
      const v = record.inputs as Inputs;
      renderCompetitors(
        v.competitors ?? [
          {
            advertorialUrl: v.advertorialUrl ?? "",
            salesPageUrl: v.salesPageUrl ?? "",
          },
        ],
      );
      el<HTMLInputElement>("branding").checked = v.createBrand;
      el<HTMLInputElement>("same-product").checked = v.sameProduct === true;
      el<HTMLSelectElement>("locale").value = v.locale;
      el<HTMLSelectElement>("currency").value = v.currency ?? "";
      productImage = v.productImage;
      showImage();
      await loadWorkflow(p.id);
    }
    message(
      "form-status",
      record
        ? record.inputs.currency
          ? "Inputs anteriores recuperados."
          : "Este registo antigo não tem moeda. Escolhe a moeda e guarda novamente."
        : "",
    );
    el<HTMLButtonElement>("save").disabled = false;
  } catch (e) {
    message("form-status", (e as Error).message);
  }
}
el("close").onclick = () => {
  if (!busy) {
    dialog.close();
    selected = null;
  }
};
dialog.addEventListener("cancel", (e) => {
  if (busy) e.preventDefault();
  else selected = null;
});
el("remove-image").onclick = () => {
  markDirty();
  productImage = null;
  el<HTMLInputElement>("image").value = "";
  showImage();
};
el("image").addEventListener("change", async () => {
  const file = el<HTMLInputElement>("image").files?.[0];
  if (!file) return;
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  ) {
    message("form-status", "Usa PNG, JPEG ou WebP até 5 MB.");
    el<HTMLInputElement>("image").value = "";
    return;
  }
  const button = el<HTMLButtonElement>("save");
  button.disabled = true;
  try {
    productImage = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () =>
        reject(new Error("Não foi possível ler a imagem."));
      reader.readAsDataURL(file);
    });
    showImage();
    message("form-status", "");
  } catch (e) {
    message("form-status", (e as Error).message);
  } finally {
    button.disabled = false;
  }
});
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selected || busy) return;
  busy = true;
  const button = el<HTMLButtonElement>("save");
  button.disabled = true;
  message("form-status", "A validar aprovação e guardar…");
  try {
    await api(`/api/inputs/${selected.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        competitors: competitorValues(),
        createBrand: el<HTMLInputElement>("branding").checked,
        sameProduct: el<HTMLInputElement>("same-product").checked,
        productImage,
        locale: el<HTMLSelectElement>("locale").value,
        currency: el<HTMLSelectElement>("currency").value,
      }),
    });
    message(
      "form-status",
      "Inputs guardados. Sessão 1 concluída; nenhuma etapa de IA foi iniciada.",
    );
    inputsDirty = false;
    await loadWorkflow(selected.id);
  } catch (e) {
    message("form-status", (e as Error).message);
  } finally {
    busy = false;
    button.disabled = false;
  }
});
el("refresh").onclick = () => void refresh();
form.addEventListener("input", (event) => {
  inputsDirty = true;
  el<HTMLButtonElement>("start-workflow").disabled = true;
});
el("start-workflow").onclick = async () => {
  if (!selected || busy || inputsDirty) return;
  const id = selected.id;
  const button = el<HTMLButtonElement>("start-workflow");
  button.disabled = true;
  message("workflow-status", "A iniciar o workflow…");
  try {
    await api(`/api/workflows/${id}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    location.href = `/workflows/${id}`;
  } catch (e) {
    message("workflow-status", (e as Error).message);
    button.disabled = false;
  }
};
el("search").addEventListener("input", render);
el("filter").addEventListener("change", render);
void refresh();

el("branding").addEventListener("change", photoRequirement);
el("same-product").addEventListener("change", photoRequirement);
el("not-now").onclick = () => {
  if (!busy) {
    dialog.close();
    selected = null;
  }
};
