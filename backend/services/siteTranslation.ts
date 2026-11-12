import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { codexTask, type TokenUsage } from "./codexTask.js";
import { readInputs, validateInputs } from "./inputs.js";
import { getMediaJob, jobPaths, type JobPaths } from "./mediaJobs.js";
import { discoverMedia, originalImageUrl } from "./mediaCollector.js";
import { enqueueAiWork, isAiWorkQueued } from "./branding.js";
import {
  readPageCaptures,
  savePageCapture,
  type CapturedPage,
  type TextBlock,
} from "./funnelCapture.js";
import {
  assetKey,
  localProjectFile,
  renderPreview,
  validateBlock,
} from "./funnelPreview.js";
import { buildTranslationContext } from "./translationContext.js";

export interface TranslationState {
  productId: string;
  status: "queued" | "running" | "awaiting_review" | "completed" | "failed";
  fingerprint: string;
  message: string;
  notes: string[];
  pages: {
    competitor: number;
    page: "advertorial" | "content";
    output: string;
  }[];
  assets: Record<string, string>;
  uniqueBlocks: number;
  translatedBlocks: number;
  cachedBlocks: number;
  usage: TokenUsage | null;
  updatedAt: string;
  approvedAt: string | null;
  previewHashes?: Record<string, string>;
}
const starting = new Set<string>();
const accesses = new Map<string, Promise<unknown>>();
function locked<T>(file: string, work: () => Promise<T>): Promise<T> {
  const next = (accesses.get(file) ?? Promise.resolve())
    .catch(() => {})
    .then(work);
  accesses.set(
    file,
    next.then(
      () => {},
      () => {},
    ),
  );
  return next;
}
const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const key = (id: string) => "translation:" + id;
const statePath = (id: string, paths: JobPaths) => {
  if (!/^[a-f0-9]{24}$/.test(id)) throw Error("Identificador inválido.");
  return path.join(path.dirname(paths.stateDir), "translations", id + ".json");
};
async function save(state: TranslationState, paths: JobPaths) {
  state.updatedAt = new Date().toISOString();
  const file = statePath(state.productId, paths);
  await mkdir(path.dirname(file), { recursive: true });
  const content = JSON.stringify(state, null, 2);
  await locked(file, async () => {
    const temp = file + "." + randomUUID();
    await writeFile(temp, content);
    await rename(temp, file);
  });
}
export async function getTranslationState(
  id: string,
  paths = jobPaths,
): Promise<TranslationState | null> {
  try {
    const file = statePath(id, paths);
    const state = JSON.parse(
      await locked(file, () => readFile(file, "utf8")),
    ) as TranslationState;
    if (
      ["running", "queued"].includes(state.status) &&
      !starting.has(id) &&
      !isAiWorkQueued(key(id))
    ) {
      state.status = "failed";
      state.message =
        "Tradução interrompida. A retoma reutiliza os blocos já traduzidos.";
      await save(state, paths);
    }
    return state;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
export async function collectMissingFunnel(
  id: string,
  paths = jobPaths,
  discover = discoverMedia,
) {
  if (starting.has(id) || isAiWorkQueued(key(id)))
    throw Error("Este workflow está ocupado.");
  const record = await readInputs(paths.inputsDir, id),
    inputs = validateInputs(record?.inputs),
    media = await getMediaJob(id, paths);
  if (!media?.projectPath || media.status === "running")
    throw Error("Espera pelo download.");
  starting.add(id);
  try {
    const known = await readPageCaptures(media.projectPath);
    for (const [index, competitor] of inputs.competitors.entries())
      for (const page of ["advertorial", "content"] as const) {
        const url =
          competitor[
            page === "advertorial" ? "advertorialUrl" : "salesPageUrl"
          ];
        if (
          known.some(
            (p) =>
              p.competitor === index + 1 &&
              p.page === page &&
              (p.capture.requestedUrl ?? p.capture.url).split("#")[0] ===
                url.split("#")[0],
          )
        )
          continue;
        const result = await discover(url);
        if (!result.capture)
          throw Error("A página não devolveu estrutura: " + url);
        await savePageCapture(media.projectPath, index + 1, page, {
          ...result.capture,
          requestedUrl: url,
        });
      }
  } finally {
    starting.delete(id);
  }
}

export async function translationInfo(id: string, paths = jobPaths) {
  const state = await getTranslationState(id, paths),
    media = await getMediaJob(id, paths);
  const pages = media?.projectPath
    ? await readPageCaptures(media.projectPath)
    : [];
  let inputError = "",
    fingerprint = "";
  try {
    fingerprint = (await buildTranslationContext(id, paths)).fingerprint;
  } catch (e) {
    inputError = (e as Error).message;
  }
  let previewsChanged = false;
  if (state?.status === "completed" && media?.projectPath)
    for (const page of state.pages) {
      try {
        if (
          sha(
            await readFile(localProjectFile(media.projectPath, page.output)),
          ) !== state.previewHashes?.[page.output]
        )
          previewsChanged = true;
      } catch {
        previewsChanged = true;
      }
    }
  return {
    state,
    capturedPages: pages.length,
    textBlocks: pages.reduce((n, p) => n + p.capture.blocks.length, 0),
    characters: pages.reduce(
      (n, p) => n + p.capture.blocks.reduce((s, b) => s + b.source.length, 0),
      0,
    ),
    inputError,
    previewsChanged,
    stale: Boolean(state && fingerprint && state.fingerprint !== fingerprint),
  };
}

export async function startTranslation(
  id: string,
  paths = jobPaths,
  task: typeof codexTask = codexTask,
) {
  if (starting.has(id) || isAiWorkQueued(key(id)))
    throw Error("A tradução já está na fila ou em execução.");
  starting.add(id);
  try {
    const ctx = await buildTranslationContext(id, paths),
      previous = await getTranslationState(id, paths);
    if (
      previous?.fingerprint === ctx.fingerprint &&
      ["awaiting_review", "completed"].includes(previous.status)
    )
      return previous;
    const rules = await readFile(
      path.join(paths.root, "agents/references/translation-prompt.md"),
      "utf8",
    );
    const template = await readFile(
      path.join(paths.root, "agents/prompts/03-translation-execution.md"),
      "utf8",
    );
    const cacheDir = path.join(
      paths.root,
      "tmp/product-media-jobs",
      id,
      "translation",
    );
    await mkdir(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, "cache.json");
    let cache: Record<string, string> = {};
    try {
      cache = JSON.parse(await readFile(cacheFile, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const cachePrefix = sha(
      JSON.stringify({
        locale: ctx.inputs.locale,
        currency: ctx.inputs.currency,
        brand: ctx.brand?.brandName ?? "",
        rules,
        template,
      }),
    );
    const blockKey = (block: TextBlock) =>
      sha(cachePrefix + block.kind + (block.role ?? "body") + block.source);
    const unique = new Map<string, TextBlock>();
    for (const p of ctx.pages)
      for (const b of p.capture.blocks) unique.set(blockKey(b), b);
    const state: TranslationState = {
      productId: id,
      status: "queued",
      fingerprint: ctx.fingerprint,
      message: "Tradução na fila. Só os textos novos serão enviados à IA.",
      notes: previous?.fingerprint === ctx.fingerprint ? previous.notes : [],
      pages: [],
      assets: {},
      uniqueBlocks: unique.size,
      translatedBlocks: 0,
      cachedBlocks: 0,
      usage: previous?.usage ?? null,
      updatedAt: new Date().toISOString(),
      approvedAt: null,
    };
    await save(state, paths);
    enqueueAiWork(key(id), async () => {
      try {
        state.status = "running";
        await save(state, paths);
        const pending = [...unique].filter(([k]) => cache[k] === undefined);
        state.cachedBlocks = unique.size - pending.length;
        state.translatedBlocks = state.cachedBlocks;
        while (pending.length) {
          const batch: typeof pending = [];
          let size = 0;
          while (
            pending.length &&
            (size + pending[0][1].source.length <= 20000 || !batch.length)
          ) {
            const item = pending.shift()!;
            batch.push(item);
            size += item[1].source.length;
          }
          state.message = `A traduzir ${batch.length} blocos. ${state.translatedBlocks}/${unique.size} concluídos; ${state.cachedBlocks} reutilizados.`;
          await save(state, paths);
          const blocks = batch.map(([k, b], i) => ({
            id: "t" + i,
            source: b.source,
            kind: b.kind,
            section: b.section,
            role: b.role ?? "body",
          }));
          const values: Record<string, string> = {
            LOCALE: ctx.inputs.locale,
            CURRENCY: ctx.inputs.currency,
            BRAND: ctx.brand?.brandName ?? "Manter a marca original",
            RULES: rules,
            BLOCKS: JSON.stringify(blocks),
          };
          const prompt = template.replace(
            /\{\{([A-Z_]+)\}\}/g,
            (_m, k) => values[k] ?? "",
          );
          const response = await task(
            prompt,
            cacheDir,
            path.join(
              paths.root,
              "agents/references/site-translation.schema.json",
            ),
            false,
          );
          if (response.usage) {
            state.usage = {
              inputTokens:
                (state.usage?.inputTokens ?? 0) + response.usage.inputTokens,
              cachedInputTokens:
                (state.usage?.cachedInputTokens ?? 0) +
                response.usage.cachedInputTokens,
              outputTokens:
                (state.usage?.outputTokens ?? 0) + response.usage.outputTokens,
            };
          }
          if (
            !Array.isArray(response.result.translations) ||
            !Array.isArray(response.result.issues)
          )
            throw Error("Resposta de tradução inválida.");
          const issues = response.result.issues as {
            id: string;
            message: string;
            blocking: boolean;
          }[];
          state.notes.push(...issues.map((i) => i.message));
          let invalid = false;
          for (const [i, [k, block]] of batch.entries()) {
            const found = response.result.translations.filter(
              (t: any) => t.id === "t" + i,
            );
            if (
              found.length !== 1 ||
              typeof found[0].text !== "string" ||
              !found[0].text.trim() ||
              issues.some((issue) => issue.blocking && issue.id === "t" + i)
            ) {
              invalid = true;
              continue;
            }
            try {
              validateBlock(block, found[0].text);
              cache[k] = found[0].text;
              state.translatedBlocks++;
            } catch (e) {
              state.notes.push((e as Error).message);
              invalid = true;
            }
          }
          await writeFile(cacheFile, JSON.stringify(cache, null, 2));
          await save(state, paths);
          if (invalid || issues.some((i) => i.blocking))
            throw Error(
              "Há blocos incompletos ou questões por resolver. A retoma conserva as traduções válidas.",
            );
        }
        if (
          (await buildTranslationContext(id, paths)).fingerprint !==
          state.fingerprint
        )
          throw Error("As fontes ou os parâmetros mudaram durante a tradução.");
        await makePreviews(id, ctx, state, cache, blockKey);
        state.status = "awaiting_review";
        state.message =
          "Tradução concluída. Revê as versões desktop e mobile e confirma nesta sessão.";
      } catch (e) {
        state.status = "failed";
        state.message = (e as Error).message;
      } finally {
        await save(state, paths);
      }
    });
    return state;
  } finally {
    starting.delete(id);
  }
}

async function makePreviews(
  id: string,
  ctx: Awaited<ReturnType<typeof buildTranslationContext>>,
  state: TranslationState,
  cache: Record<string, string>,
  blockKey: (block: TextBlock) => string,
) {
  for (const p of ctx.pages) {
    const translations = Object.fromEntries(
      p.capture.blocks.map((b) => [b.id, cache[blockKey(b)]]),
    );
    const media: Record<string, string> = {};
    state.notes.push(...p.capture.limitations);
    for (const ref of p.capture.media) {
      if (!ref.url) continue;
      if (/logo/i.test(ref.url) && ctx.brand?.approvedAt && ctx.brand.logo) {
        const logoId=assetKey(ctx.brand.logo);state.assets[logoId]=ctx.brand.logo;
        media[ref.id]=`/api/workflows/${id}/translation/assets/${logoId}`;
        continue;
      }
      const asset = ctx.media.assets.find((a) =>
        [a.sourceUrl, ...(a.sources ?? []).map((s) => s.url)].some(
          (url) =>
            originalImageUrl(url, p.capture.url) ===
            originalImageUrl(ref.url, p.capture.url),
        ),
      );
      if (!asset) {
        if (ref.url) state.notes.push(`Imagem sem ficheiro local: ${ref.url}`);
        continue;
      }
      const selected = ctx.brand?.selection.find(
        (s) => s.hash === asset.hash || s.hash === asset.downloadedHash,
      );
      const output = selected
        ? selected.status === "completed"
          ? selected.output
          : undefined
        : asset.optimized ?? asset.original;
      if (!output) {
        state.notes.push(
          `Imagem tratada externamente ou sem resultado local: ${ref.url}`,
        );
        continue;
      }
      const file = localProjectFile(ctx.project, output);
      await readFile(file);
      const assetId = assetKey(output);
      state.assets[assetId] = output;
      media[ref.id] = `/api/workflows/${id}/translation/assets/${assetId}`;
    }
    const dir = path.join("funil/preview", `competitor-${p.competitor}`),
      output = path
        .join(dir, p.page + ".html")
        .split(path.sep)
        .join("/");
    await mkdir(path.join(ctx.project, dir), { recursive: true });
    await writeFile(
      path.join(ctx.project, output),
      renderPreview(p.capture, translations, ctx.inputs.locale, media),
    );
    const translatedDir = path.join(
      ctx.project,
      "funil/traducao",
      `competitor-${p.competitor}`,
    );
    await mkdir(translatedDir, { recursive: true });
    await writeFile(
      path.join(translatedDir, p.page + ".json"),
      JSON.stringify(
        {
          locale: ctx.inputs.locale,
          url: p.capture.url,
          blocks: p.capture.blocks.map((b) => ({
            ...b,
            translation: translations[b.id],
          })),
        },
        null,
        2,
      ),
    );
    state.pages.push({ competitor: p.competitor, page: p.page, output });
  }
  state.notes = [...new Set(state.notes)];
}

export async function approveTranslation(id: string, paths = jobPaths) {
  if (starting.has(id) || isAiWorkQueued(key(id)))
    throw Error("A tradução ainda está em execução.");
  const state = await getTranslationState(id, paths),
    ctx = await buildTranslationContext(id, paths);
  if (
    !state ||
    !["awaiting_review", "completed"].includes(state.status) ||
    state.fingerprint !== ctx.fingerprint
  )
    throw Error("Revê uma tradução atualizada antes de aprovar.");
  state.previewHashes = {};
  for (const page of state.pages)
    state.previewHashes[page.output] = sha(
      await readFile(localProjectFile(ctx.project, page.output)),
    );
  if (state.pages.length !== ctx.pages.length)
    throw Error("Faltam páginas para revisão.");
  state.status = "completed";
  state.approvedAt = new Date().toISOString();
  state.message =
    "Tradução e revisão local aprovadas. Transferência para Funnelish por implementar.";
  await save(state, paths);
  return state;
}
