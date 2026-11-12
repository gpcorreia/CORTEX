import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  unlink,
  lstat,
  rename,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { codexTask, type TokenUsage } from "./codexTask.js";
import { createBundles } from "./bundles.js";
import { readInputs, validateInputs } from "./inputs.js";
import { getMediaJob, jobPaths, type JobPaths } from "./mediaJobs.js";
import { imageFormat, animationInfo } from "./mediaCollector.js";
import { prepareBatchImages, importBatchAsset, type BatchEdit } from "./brandBatch.js";
import { adaptAnimation } from "./animation.js";
import sharp from "sharp";
import { ensureSourceBackup, rasterLogoReference } from "./mediaSources.js";
import { importGeneratedImage, convertImageToWebp } from "../tools/images.js";
import { prepareProductReference, productEditPolicy } from "./productReference.js";
export interface SelectedAsset {
  path: string;
  source: string;
  hash: string;
  animated: boolean;
  frameCount?: number | null;
  format: string;
  action: "keep" | "translate" | "replace" | "both";
  output?: string;
  status: "pending" | "completed";
  error?: string;
  attempts?: number;
  generatedSource?: string;
}
export interface BrandState {
  productId: string;
  status:
    | "queued"
    | "generating_names"
    | "awaiting_name_choice"
    | "awaiting_brand_creation"
    | "preparing"
    | "awaiting_approval"
    | "adapting"
    | "completed"
    | "needs_attention"
    | "skipped"
    | "failed";
  revision: number;
  brandName: string;
  nameOptions?: {
    id: string;
    name: string;
    kind: "product_adaptation" | "creative_related";
    reason: string;
  }[];
  selectedNameId?: string;
  nameSource?: "user" | "suggested";
  logoReference?: string;
  draftAvailable?: boolean;
  qualityWarning?: boolean;
  logo: string;
  master: string;
  bundleQuantities: number[];
  bundles: { quantity: number; path: string }[];
  selection: SelectedAsset[];
  inputHash: string;
  message: string;
  notes: string[];
  usage: TokenUsage | null;
  approvedAt: string | null;
  approvedHashes?: { logo: string; master: string };
  updatedAt: string;
}
export interface BrandDependencies {
  task: typeof codexTask;
  bundles: typeof createBundles;
  importImage?: typeof importGeneratedImage;
}
const defaults: BrandDependencies = { task: codexTask, bundles: createBundles };
const queued = new Set<string>();
const requests = new Set<string>();
let working = false;
const tasks: Array<() => Promise<void>> = [];
const writes = new Map<string, Promise<void>>();
const digest = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
function stateFile(id: string, paths: JobPaths) {
  if (!/^[a-f0-9]{24}$/.test(id)) throw Error("Identificador inválido.");
  return path.join(path.dirname(paths.stateDir), "branding", id + ".json");
}
async function save(state: BrandState, paths: JobPaths) {
  state.updatedAt = new Date().toISOString();
  const file = stateFile(state.productId, paths);
  await mkdir(path.dirname(file), { recursive: true });
  const text = JSON.stringify(state, null, 2);
  const write = (writes.get(file) ?? Promise.resolve())
    .catch(() => {})
    .then(() => writeFile(file, text));
  writes.set(file, write);
  await write;
}
export async function getBrandState(
  id: string,
  paths = jobPaths,
): Promise<BrandState | null> {
  const file = stateFile(id, paths);
  const reading = (writes.get(file) ?? Promise.resolve()).then(() =>
    readFile(file, "utf8"),
  );
  writes.set(
    file,
    reading.then(
      () => {},
      () => {},
    ),
  );
  try {
    const state = JSON.parse(await reading) as BrandState;
    if (
      ["queued", "generating_names", "preparing", "adapting"].includes(
        state.status,
      ) &&
      !isBrandBusy(id)
    ) {
      state.status = "failed";
      state.message =
        "Execução de IA interrompida. Os ficheiros foram preservados.";
      await save(state, paths);
    }
    if (state.status === "failed" && !state.approvedAt && state.brandName) {
      const media = await getMediaJob(id, paths);
      state.draftAvailable = Boolean(
        media?.projectPath &&
        (await draftFiles(media.projectPath, state.revision)),
      );
    }
    return state;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
export const isBrandBusy = (id: string) => queued.has(id) || requests.has(id);
async function draftFiles(project: string, revision: number) {
  const logo = "brand/logo.svg";
  const master = `brand/product-master-r${revision}.webp`;
  try {
    if (!(await lstat(safeFile(project, logo))).isFile()) return null;
    if (!(await lstat(safeFile(project, master))).isFile())
      return null;
    if (imageFormat(await readFile(safeFile(project, master))) !== "webp")
      return null;
    return { logo, master };
  } catch {
    return null;
  }
}

async function manualBrandReference(project: string) {
  const brandDir = path.join(project, "brand");
  const entries = await readdir(brandDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || /^(logo(?:-r)?|product-master-r|pack-|reference-r)/.test(entry.name)) continue;
    const relative = `brand/${entry.name}`;
    try {
      const metadata = await sharp(await readFile(safeFile(project, relative))).metadata();
      if ((metadata.pages ?? 1) === 1) return relative;
    } catch {}
  }
  throw Error("Coloca uma imagem estática de referência na pasta brand antes de criar o logo e as bundles.");
}
export async function reviewBrandDraft(id: string, paths = jobPaths) {
  return serializedAction(id, async () => {
    const state = await getBrandState(id, paths);
    const media = await getMediaJob(id, paths);
    if (
      state?.status !== "failed" ||
      state.approvedAt ||
      !state.brandName ||
      !media?.projectPath ||
      media.status !== "approved"
    )
      throw Error("Não há um rascunho disponível para revisão.");
    const record = await readInputs(paths.inputsDir, id);
    if (
      digest(JSON.stringify(validateInputs(record?.inputs))) !== state.inputHash
    )
      throw Error("Os parâmetros mudaram. Valida novamente o branding.");
    await unchanged(media.projectPath, state.selection);
    const files = await draftFiles(media.projectPath, state.revision);
    if (!files)
      throw Error("O logo ou o produto guardado está em falta ou é inválido.");
    Object.assign(state, files);
    if (state.bundleQuantities.length)
      state.bundles = await createBundles(
        media.projectPath,
        state.master,
        state.bundleQuantities,
        state.revision,
      );
    state.qualityWarning = false;
    state.status = "awaiting_approval";
    state.message =
      "Logo, product master e bundles recuperados. Revê tudo antes de iniciar Media.";
    await save(state, paths);
    return state;
  });
}
function enqueue(id: string, fn: () => Promise<void>) {
  queued.add(id);
  tasks.push(async () => {
    try {
      await fn();
    } catch (error) {
      // A disk failure in one workflow must not break the shared queue or abort other products.
      console.error(
        "Falha ao concluir tarefa de IA:",
        (error as Error).message,
      );
    } finally {
      queued.delete(id);
    }
  });
  void drain();
}
// Translation shares the same serial AI queue as image generation.
export const enqueueAiWork = (key: string, work: () => Promise<void>) =>
  enqueue(key, work);
export const isAiWorkQueued = (key: string) => queued.has(key);
async function drain() {
  if (working) return;
  working = true;
  try {
    while (tasks.length) await tasks.shift()!();
  } finally {
    working = false;
  }
}
function addUsage(state: BrandState, usage: TokenUsage | null) {
  if (usage)
    state.usage = {
      inputTokens: (state.usage?.inputTokens ?? 0) + usage.inputTokens,
      cachedInputTokens:
        (state.usage?.cachedInputTokens ?? 0) + usage.cachedInputTokens,
      outputTokens: (state.usage?.outputTokens ?? 0) + usage.outputTokens,
    };
}
export function safeFile(project: string, relative: string) {
  const full = path.resolve(project, relative);
  if (!full.startsWith(path.resolve(project) + path.sep))
    throw Error("Caminho de ficheiro inválido.");
  return full;
}
export async function selectedImages(project: string) {
  const result: Omit<SelectedAsset, "source" | "action" | "status">[] = [];
  for (const section of ["advertorial", "content"])
    for (const entry of await readdir(
      path.join(project, section, "generator"),
      { withFileTypes: true },
    )) {
      if (!entry.isFile()) continue;
      const relative = `${section}/generator/${entry.name}`,
        bytes = await readFile(safeFile(project, relative)),
        format = imageFormat(bytes);
      if (!format) continue;
      result.push({
        path: relative,
        hash: digest(bytes),
        format,
        ...animationInfo(bytes, format),
      });
    }
  return result;
}
async function snapshot(project: string) {
  const selected = await selectedImages(project),
    result: SelectedAsset[] = [];
  for (const asset of selected) {
    const section = asset.path.split("/")[0];
    const source = `${section}/copy/selected-${asset.hash.slice(0, 24)}.${asset.format}`,
      bytes = await readFile(safeFile(project, asset.path));
    try {
      await writeFile(safeFile(project, source), bytes, { flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (digest(await readFile(safeFile(project, source))) !== asset.hash)
        throw Error("A cópia de segurança da seleção está em conflito.");
    }
    result.push({ ...asset, source, action: "keep", status: "pending" });
  }
  return result;
}
async function unchanged(project: string, selection: SelectedAsset[]) {
  const current = await selectedImages(project);
  for (const asset of selection)
    if (
      asset.status !== "completed" &&
      !current.some(
        (item) => item.path === asset.path && item.hash === asset.hash,
      )
    )
      throw Error(
        "A seleção do generator mudou. Valida novamente antes de continuar.",
      );
}
export async function skipBranding(id: string, paths = jobPaths) {
  const state: BrandState = {
    productId: id,
    status: "skipped",
    revision: 0,
    brandName: "",
    logo: "",
    master: "",
    bundleQuantities: [],
    bundles: [],
    selection: [],
    inputHash: "",
    message: "Sem branding: produto e imagens mantidos, sem IA.",
    notes: [],
    usage: null,
    approvedAt: null,
    updatedAt: new Date().toISOString(),
  };
  await save(state, paths);
  return state;
}
async function prepareBrandInternal(
  id: string,
  quantities: unknown,
  paths = jobPaths,
  deps = defaults,
) {
  return prepareBrandPreviewInternal(id, quantities, paths, deps);
/* legacy batch implementation retained below while existing in-progress states are read
  if (queued.has(id))
    throw Error("Este workflow já tem uma tarefa de IA em curso.");
  const media = await getMediaJob(id, paths);
  if (!media?.projectPath || media.status !== "approved")
    throw Error("Valida primeiro a seleção de imagens.");
  const record = await readInputs(paths.inputsDir, id),
    inputs = validateInputs(record?.inputs);
  if (!inputs.createBrand) return skipBranding(id, paths);
  const previous = await getBrandState(id, paths),
    selection = await snapshot(media.projectPath);
  if (
    !previous?.selectedNameId ||
    (!(
      previous.nameSource === "user" &&
      previous.selectedNameId === "custom" &&
      normalizeBrandName(previous.brandName) === previous.brandName
    ) &&
      !previous.nameOptions?.some(
        (option) =>
          option.id === previous.selectedNameId &&
          option.name === previous.brandName,
      ))
  )
    throw Error("Escolhe primeiro uma das três marcas propostas.");
  if (previous.inputHash !== digest(JSON.stringify(inputs)))
    throw Error("Os parâmetros mudaram. Pede novas opções de marca.");
  if (!selection.length)
    throw Error(
      "Coloca as imagens escolhidas em advertorial/generator e content/generator antes de validar.",
    );
  const state: BrandState = {
    productId: id,
    status: "queued",
    revision: (previous?.revision ?? 0) + 1,
    brandName: previous?.brandName ?? "",
    nameOptions: previous.nameOptions,
    selectedNameId: previous.selectedNameId,
    nameSource: previous.nameSource,
    logoReference: previous.logoReference,
    logo: "",
    master: "",
    bundleQuantities: [],
    bundles: [],
    selection,
    inputHash: digest(JSON.stringify(inputs)),
    message:
      "Branding na fila. Os downloads de outros produtos podem continuar.",
    notes: [],
    usage: previous?.usage ?? null,
    approvedAt: null,
    updatedAt: new Date().toISOString(),
  };
  state.mode = "batch";
  state.approvedAt = new Date().toISOString();
  await save(state, paths);
  enqueue(id, async () => {
    try {
      state.status = "adapting";
      state.message = "A aplicar a marca à seleção num único pedido de IA.";
      await save(state, paths);
      const cache = path.join(paths.root, "tmp/product-media-jobs", id, "brand-batch-r" + state.revision);
      const prepared = await prepareBatchImages(media.projectPath!, selection, cache);
      const reference = inputs.productImage
        ? await prepareProductReference(media.projectPath!, state.revision, inputs, media.assets ?? [], selection)
        : "";
      const prompt = await renderPrompt(paths, "batch", {
        BRAND_NAME: state.brandName, PRODUCT_POLICY: productEditPolicy(inputs),
        REFERENCE: reference, LOCALE: inputs.locale, CURRENCY: inputs.currency,
        EDITS: JSON.stringify(prepared.images),
        TRANSLATION: await readFile(path.join(paths.root, "agents/references/translation-prompt.md"), "utf8"),
      });
      const response = await deps.task(prompt, media.projectPath!,
        path.join(paths.root, "agents/references/brand-batch.schema.json"), true);
      addUsage(state, response.usage);
      await unchanged(media.projectPath!, selection);
      await writeFile(path.join(cache, "result.json"), JSON.stringify(response.result));
      state.notes = Array.isArray(response.result.notes) ? response.result.notes : [];
      if (!Array.isArray(response.result.edits)) throw Error("Resultados das imagens em falta.");
      const edits: BatchEdit[] = response.result.edits;
      for (const asset of state.selection) {
        try {
          await importBatchAsset(media.projectPath!, asset, state.revision, cache, prepared, edits, deps.importImage);
          await save(state, paths);
          if (asset.output !== asset.path) await unlink(safeFile(media.projectPath!, asset.path));
        } catch (error) {
          asset.error = (error as Error).message;
          state.notes.push(asset.path + ": " + asset.error);
        }
      }
      state.status = state.selection.every((asset) => asset.status === "completed") ? "completed" : "needs_attention";
      state.message = state.status === "completed"
        ? "Marca aplicada às imagens selecionadas. Resultados prontos para revisão."
        : "Há imagens pendentes; os originais e resultados recebidos estão guardados. Sem nova chamada automática.";
    } catch (error) {
      state.status = "failed";
      state.message = (error as Error).message;
    } finally { await save(state, paths); }
  });
  return state;
*/
}

async function prepareBrandPreviewInternal(
  id: string,
  quantities: unknown,
  paths = jobPaths,
  deps = defaults,
) {
  if (queued.has(id)) throw Error("Este workflow já tem uma tarefa de IA em curso.");
  const media = await getMediaJob(id, paths);
  if (!media?.projectPath || media.status !== "approved")
    throw Error("Valida primeiro a seleção de imagens.");
  const record = await readInputs(paths.inputsDir, id);
  const inputs = validateInputs(record?.inputs);
  const previous = await getBrandState(id, paths);
  if (!previous?.selectedNameId || !previous.brandName)
    throw Error("Escolhe primeiro uma das três marcas propostas.");
  if (previous.inputHash !== digest(JSON.stringify(inputs)))
    throw Error("Os parâmetros mudaram. Pede novas opções de marca.");
  if (
    !Array.isArray(quantities) ||
    !quantities.length ||
    quantities.some((n) => !Number.isInteger(n) || n < 1 || n > 12)
  )
    throw Error("Indica as quantidades das bundles (1 a 12 unidades).");
  const selection = await snapshot(media.projectPath);
  if (!selection.length)
    throw Error("Coloca imagens selecionadas nas pastas generator antes de continuar.");

  const revision = (previous.revision ?? 0) + 1;
  const state: BrandState = {
    productId: id,
    status: "queued",
    revision,
    brandName: previous.brandName,
    nameOptions: previous.nameOptions,
    selectedNameId: previous.selectedNameId,
    nameSource: previous.nameSource,
    logo: "",
    master: "",
    bundleQuantities: [...new Set<number>(quantities)],
    bundles: [],
    selection,
    inputHash: digest(JSON.stringify(inputs)),
    message: "A criar o logo e o product master com a marca escolhida.",
    notes: [],
    usage: previous.usage ?? null,
    approvedAt: null,
    updatedAt: new Date().toISOString(),
  };
  await save(state, paths);
  enqueue(id, async () => {
    try {
      state.status = "preparing";
      await save(state, paths);
      const reference = await manualBrandReference(media.projectPath!);
      const logo = "brand/logo.svg";
      const master = `brand/product-master-r${revision}.webp`;
      const prompt = await renderPrompt(paths, "branding", {
        REFERENCE: safeFile(media.projectPath!, reference),
        BRAND_NAME_RULE: `Use exactly ${state.brandName}™ in the logo.`,
        PRODUCT_CONTEXT: String(record?.productName ?? ""),
        LOGO_TARGET: safeFile(media.projectPath!, logo),
        MASTER_TARGET: safeFile(media.projectPath!, master),
      });
      const response = await deps.task(
        prompt,
        media.projectPath!,
        path.join(paths.root, "agents/references/branding-result.schema.json"),
        true,
      );
      addUsage(state, response.usage);
      if (response.result?.status !== "completed")
        throw Error("A criação do logo precisa de revisão antes de continuar.");
      const masterFile = safeFile(media.projectPath!, master);
      const masterBytes = await readFile(masterFile);
      if (imageFormat(masterBytes) !== "webp") {
        const normalized = masterFile + ".normalizing";
        await sharp(masterBytes).webp({ lossless: true }).toFile(normalized);
        await rename(normalized, masterFile);
      }
      const files = await draftFiles(media.projectPath!, revision);
      if (!files) throw Error("O logo ou o produto transparente não foram criados nos destinos esperados.");
      state.logo = files.logo;
      state.master = files.master;
      state.bundles = await deps.bundles(
        media.projectPath!,
        state.master,
        state.bundleQuantities,
        state.revision,
      );
      state.notes = Array.isArray(response.result.notes) ? response.result.notes : [];
      state.status = "awaiting_approval";
      state.message = "Logo, product master e bundles prontos. Revê e aprova antes de iniciar Media.";
    } catch (error) {
      state.status = "failed";
      state.message = (error as Error).message;
    } finally {
      await save(state, paths);
    }
  });
  return state;
}

async function approveBrandInternal(
  id: string,
  quantities: unknown,
  paths = jobPaths,
  deps = defaults,
  retry = false,
) {
  if (queued.has(id)) throw Error("Já existe uma tarefa para este workflow.");
  const state = await getBrandState(id, paths),
    media = await getMediaJob(id, paths);
  if (
    !state ||
    (!retry && state.status !== "awaiting_approval") ||
    (retry &&
      (!state.approvedAt ||
        !["failed", "needs_attention"].includes(state.status))) ||
    !media?.projectPath
  )
    throw Error("O branding ainda não está pronto para aprovação.");
  if (
    !Array.isArray(quantities) ||
    !quantities.length ||
    quantities.some((n) => !Number.isInteger(n) || n < 1 || n > 12)
  )
    throw Error("Confirma as quantidades reais das ofertas (1 a 12 unidades).");
  const record = await readInputs(paths.inputsDir, id),
    inputs = validateInputs(record?.inputs);
  if (digest(JSON.stringify(inputs)) !== state.inputHash)
    throw Error("Os parâmetros mudaram. Volta a validar o branding.");
  await unchanged(media.projectPath, state.selection);
  const artifactHashes = {
    logo: digest(await readFile(safeFile(media.projectPath, state.logo))),
    master: digest(await readFile(safeFile(media.projectPath, state.master))),
  };
  if (
    retry &&
    (!state.approvedHashes ||
      state.approvedHashes.logo !== artifactHashes.logo ||
      state.approvedHashes.master !== artifactHashes.master)
  )
    throw Error(
      "O logo ou o master aprovado mudou. É necessária nova validação.",
    );
  state.approvedHashes = artifactHashes;
  const bundleQuantities = [...new Set<number>(quantities)];
  if (
    !state.bundles.length ||
    JSON.stringify(state.bundleQuantities) !== JSON.stringify(bundleQuantities)
  ) {
    state.bundleQuantities = bundleQuantities;
    state.bundles = await deps.bundles(
      media.projectPath,
      state.master,
      state.bundleQuantities,
      state.revision,
    );
    state.status = "awaiting_approval";
    state.message = "Bundles prontos. Revê o logo e as bundles antes de iniciar a adaptação das imagens.";
    await save(state, paths);
    return state;
  }
  state.bundleQuantities = bundleQuantities;
  state.approvedAt ??= new Date().toISOString();
  state.status = "queued";
  state.message = "Marca aprovada. A preparar bundles locais e adaptações.";
  await save(state, paths);
  enqueue(id, async () => {
    try {
      state.status = "adapting";
      await save(state, paths);
      for (const asset of state.selection.filter((a) => a.status !== "completed")) {
        await ensureSourceBackup(media.projectPath!, asset);
        asset.action = "both";
      }
      await save(state, paths);
      if (!state.bundles.length)
        state.bundles = await deps.bundles(
          media.projectPath!,
          state.master,
          state.bundleQuantities,
          state.revision,
        );
      await save(state, paths);
      const edits = state.selection.filter(
        (a) => a.action !== "keep" && a.status !== "completed",
      );
      for (const asset of state.selection.filter((a) => a.action === "keep")) {
        asset.status = "completed";
        asset.output = asset.path;
      }
      if (edits.length) {
        const translation = edits.some(
          (a) => a.action === "translate" || a.action === "both",
        )
          ? await readFile(
              path.join(paths.root, "agents/references/translation-prompt.md"),
              "utf8",
            )
          : "";

        const editOne = async (
          source: string,
          target: string,
          cwd: string,
          asset: SelectedAsset,
          frame?: { index: number; total: number },
        ) => {
          const logoReference = await rasterLogoReference(
            media.projectPath!,
            state.logo,
            path.join(paths.root, "tmp/product-media-jobs", id, "references"),
          );
          asset.attempts = (asset.attempts ?? 0) + 1;
          await save(state, paths);
          const canvas = await sharp(
            await readFile(
              frame ? source : safeFile(media.projectPath!, asset.source),
            ),
          ).metadata();
          const prompt = await renderPrompt(paths, "adaptation", {
            PRODUCT_POLICY: productEditPolicy(inputs),
            BRAND_NAME: state.brandName,
            LOGO: logoReference,
            MASTER: safeFile(media.projectPath!, state.master),
            LOCALE: inputs.locale,
            TRANSLATION: translation,
            EDITS: JSON.stringify([
              {
                path: source,
                source: frame
                  ? source
                  : safeFile(media.projectPath!, asset.source),
                action: asset.action,
                animated: false,
                outputTarget: target,
                width: canvas.width,
                height: canvas.height,
                authorizedAttempt: true,
                attemptNumber: asset.attempts,
                sourceHash: frame ? undefined : asset.hash,
                ...(frame ? { frame } : {}),
              },
            ]),
            SUFFIX: "-branded-r" + state.revision + ".webp",
            FINALIZE_HELPER: path.join(
              paths.root,
              "scripts/finalize-brand-image.mjs",
            ),
          });
          const response = await deps.task(
            prompt,
            cwd,
            path.join(
              paths.root,
              "agents/references/adaptation-result.schema.json",
            ),
            true,
            (text) => {
              state.message = `${asset.path}${frame ? ` · frame ${frame.index + 1}/${frame.total}` : ""}: ${text}`;
              void save(state, paths).catch(() => {});
            },
          );
          addUsage(state, response.usage);
          state.notes.push(...(response.result.notes ?? []));
          await unchanged(media.projectPath!, state.selection);
          const result = response.result.edits?.find(
            (r: any) => r.path === source,
          );
          if (
            result?.status !== "completed" ||
            typeof result.output !== "string"
          )
            throw Error(
              response.result.notes?.join(" · ") ||
                "A ferramenta deixou esta imagem pendente.",
            );
          const generated = path.resolve(cwd, String(result.output));
          if (generated !== target) {
            if (!frame) {
              asset.generatedSource = generated;
              await save(state, paths);
            }
            await (deps.importImage ?? importGeneratedImage)(
              generated,
              target,
              frame ? source : safeFile(media.projectPath!, asset.source),
            );
          }
          return true;
        };
        // One independent task per static image. Animations run only after all static work is done.
        for (const asset of [...edits].sort(
          (a, b) => Number(a.animated) - Number(b.animated),
        )) {
          try {
            if (
              asset.animated &&
              state.selection.some(
                (a) => !a.animated && a.status !== "completed",
              )
            ) {
              asset.error = "A aguardar a conclusão das imagens estáticas.";
              await save(state, paths);
              continue;
            }
            if (await ensureSourceBackup(media.projectPath!, asset))
              state.notes.push(
                `${asset.path}: cópia de origem reposta localmente a partir do original aprovado.`,
              );
            delete asset.error;
            state.message = `A adaptar ${asset.path}. Imagens concluídas: ${state.selection.filter((a) => a.status === "completed").length}/${state.selection.length}.`;
            await save(state, paths);
            const output =
              asset.path.slice(0, -path.extname(asset.path).length) +
              `-branded-r${state.revision}.${asset.animated ? asset.format : "webp"}`;
            const target = safeFile(media.projectPath!, output);
            let exists = false;
            try {
              await lstat(target);
              exists = true;
            } catch (e) {
              if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
            }
            if (!exists) {
              if (!asset.animated && asset.generatedSource) {
                await (deps.importImage ?? importGeneratedImage)(
                  asset.generatedSource,
                  target,
                  safeFile(media.projectPath!, asset.source),
                );
              } else if (asset.animated) {
                const fingerprint = digest(
                  JSON.stringify({
                    hash: asset.hash,
                    approved: state.approvedHashes,
                    locale: inputs.locale,
                    action: asset.action,
                  }),
                );
                const workDir = path.join(
                  paths.root,
                  "tmp/product-media-jobs",
                  id,
                  `animation-r${state.revision}-${fingerprint.slice(0, 24)}`,
                );
                await adaptAnimation(
                  safeFile(media.projectPath!, asset.source),
                  target,
                  workDir,
                  (source, destination, index, total) =>
                    editOne(source, destination, workDir, asset, {
                      index,
                      total,
                    }),

                );
              } else
                await editOne(asset.path, target, media.projectPath!, asset);
            }
            await unchanged(media.projectPath!, state.selection);
            if (
              digest(
                await readFile(safeFile(media.projectPath!, state.logo)),
              ) !== state.approvedHashes!.logo ||
              digest(
                await readFile(safeFile(media.projectPath!, state.master)),
              ) !== state.approvedHashes!.master
            )
              throw Error(
                "O logo ou master aprovado foi alterado durante a adaptação.",
              );
            if (
              path.posix.dirname(output) !== path.posix.dirname(asset.path) ||
              state.selection.some((a) => a.path === output) ||
              !path.basename(output).includes(`-branded-r${state.revision}`)
            )
              throw Error("A edição devolveu um destino inválido.");
            const bytes = await readFile(safeFile(media.projectPath!, output)),
              format = imageFormat(bytes);
            if (
              !format ||
              (!asset.animated && format !== "webp") ||
              (asset.animated &&
                (!animationInfo(bytes, format).animated ||
                  format !== asset.format ||
                  animationInfo(bytes, format).frameCount !==
                    asset.frameCount)) ||
              !output.toLowerCase().endsWith("." + format)
            )
              throw Error("A edição tem formato ou animação inválidos.");
            const before = await sharp(
              await readFile(safeFile(media.projectPath!, asset.source)),
              { animated: true },
            ).metadata();
            const after = await sharp(bytes, { animated: true }).metadata();
            if (
              before.width !== after.width ||
              (before.pageHeight ?? before.height) !==
                (after.pageHeight ?? after.height) ||
              (asset.animated &&
                (JSON.stringify(before.delay) !== JSON.stringify(after.delay) ||
                  (before.loop ?? 1) !== (after.loop ?? 1)))
            )
              throw Error(
                "A edição alterou as dimensões, os tempos ou a repetição do original.",
              );
            asset.output = output;
            asset.status = "completed";
            delete asset.error;
            // Persist completion before removing the selected input: an interrupted run can resume safely.
            await save(state, paths);
            await unlink(safeFile(media.projectPath!, asset.path));
          } catch (e) {
            asset.error = (e as Error).message;
            state.notes.push(`${asset.path}: ${asset.error}`);
            await save(state, paths);
            if (
              /usage limit|quota exceeded|insufficient credits|rate.limit|not logged in/i.test(
                asset.error,
              )
            )
              break;
          }
        }
      }
      state.status = state.selection.every((a) => a.status === "completed")
        ? "completed"
        : "needs_attention";
      state.message =
        state.status === "completed"
          ? "Branding e imagens selecionadas concluídos."
          : "Há imagens pendentes. Consulta as notas; os originais estão preservados.";
    } catch (e) {
      state.status = "failed";
      state.message = (e as Error).message;
    } finally {
      await save(state, paths);
    }
  });
  return state;
}

async function renderPrompt(
  paths: JobPaths,
  file: string,
  values: Record<string, string>,
) {
  const template = await readFile(
    path.join(paths.root, "agents/prompts/02-brand-and-media.md"), "utf8",
  );
  const fields: Record<string, string[]> = {
    names: ["CONTEXT"],
    batch: ["BRAND_NAME", "PRODUCT_POLICY", "REFERENCE", "LOGO", "MASTER", "LOCALE", "CURRENCY", "EDITS"],
    branding: ["REFERENCE", "BRAND_NAME_RULE", "PRODUCT_CONTEXT", "LOGO_TARGET", "MASTER_TARGET"],
    adaptation: ["PRODUCT_POLICY", "BRAND_NAME", "LOGO", "MASTER", "LOCALE", "EDITS"],
  };
  const data = Object.fromEntries(fields[file].map((key) => {
    let value: unknown = values[key];
    try { value = JSON.parse(values[key]); } catch {}
    return [key, value];
  }));
  const instructions: Record<string, string> = {
    names: "Suggest exactly three distinct, single-word brand names: one product adaptation and two creative related names. Do not create files or images.",
    branding: "Create the chosen transparent SVG logo at LOGO_TARGET. The logo must contain a compact, professional symbol clearly related to PRODUCT_CONTEXT, positioned immediately before or visually integrated behind the start of the wordmark; a plain text-only wordmark is invalid. Write the exact brand name followed immediately by ™, with no other wording. Then create one transparent product master at MASTER_TARGET from REFERENCE, preserving the exact product and professionally replacing only the visible original branding with that exact symbol plus wordmark logo. The symbol, wordmark and ™ on the master must match LOGO_TARGET. Do not edit generator media, create bundles, suggest names, validate results, wait for approval, or request fields other than the stated Data.",
    batch: "Edit the complete supplied EDITS selection in this single operation. Use LOGO and MASTER as the approved visual references. Apply the exact BRAND_NAME only where branding belongs, follow PRODUCT_POLICY, translate visible source-language text to LOCALE using the Translation reference, and preserve product facts, composition, dimensions, transparency and animation-frame consistency. Return keep only when an image genuinely needs no branding or text change; otherwise return an actual generated output path for every edit. Do not approve, retry, create bundles, change workflow state, or communicate with the user.",
    adaptation: "Edit only the supplied EDITS. Use LOGO and MASTER as visual references when needed; never create a new logo, master or bundle. Preserve dimensions, transparency, product facts and animation properties. Return an actual generated output path for each completed edit.",
  };
  return template.trim() + "\nOperation: " + file + "\nInstruction: " +
    instructions[file] + "\nData: " +
    JSON.stringify(data) + (values.TRANSLATION ? "\nTranslation reference:\n" + values.TRANSLATION : "");

}

async function approveBrandBatchInternal(
  id: string,
  quantities: unknown,
  paths = jobPaths,
  deps = defaults,
  retry = false,
) {
  if (queued.has(id)) throw Error("Já existe uma tarefa para este workflow.");
  const state = await getBrandState(id, paths);
  const media = await getMediaJob(id, paths);
  if (
    !state ||
    !media?.projectPath ||
    (!retry && state.status !== "awaiting_approval") ||
    (retry && (!state.approvedAt || !["failed", "needs_attention"].includes(state.status)))
  )
    throw Error("O branding ainda não está pronto para aprovação.");
  if (
    !Array.isArray(quantities) ||
    JSON.stringify([...new Set(quantities)]) !== JSON.stringify(state.bundleQuantities)
  )
    throw Error("As quantidades mudaram. Volta a criar o branding e as bundles.");

  const record = await readInputs(paths.inputsDir, id);
  const inputs = validateInputs(record?.inputs);
  if (digest(JSON.stringify(inputs)) !== state.inputHash)
    throw Error("Os parâmetros mudaram. Volta a validar o branding.");
  await unchanged(media.projectPath, state.selection);

  const artifactHashes = {
    logo: digest(await readFile(safeFile(media.projectPath, state.logo))),
    master: digest(await readFile(safeFile(media.projectPath, state.master))),
  };
  if (
    retry &&
    (!state.approvedHashes ||
      state.approvedHashes.logo !== artifactHashes.logo ||
      state.approvedHashes.master !== artifactHashes.master)
  )
    throw Error("O logo ou o master aprovado mudou. É necessária nova validação.");

  state.approvedHashes = artifactHashes;
  state.approvedAt ??= new Date().toISOString();
  state.status = "queued";
  state.message = retry
    ? "Retoma pedida pelo utilizador. A preparar apenas os ficheiros pendentes."
    : "Branding aprovado. A preparar uma única edição para toda a seleção.";
  await save(state, paths);

  enqueue(id, async () => {
    try {
      state.status = "adapting";
      const pending = state.selection.filter((asset) => asset.status !== "completed");
      for (const asset of pending) {
        await ensureSourceBackup(media.projectPath!, asset);
        asset.action = "both";
        delete asset.error;
      }
      state.message = `A editar ${pending.length} ficheiro(s) selecionado(s) num único pedido de IA.`;
      await save(state, paths);

      if (!pending.length) {
        state.status = "completed";
        state.message = "Branding e imagens selecionadas concluídos.";
        await save(state, paths);
        return;
      }

      const cache = path.join(
        paths.root,
        "tmp/product-media-jobs",
        id,
        `brand-batch-r${state.revision}${retry ? `-retry-${Date.now()}` : ""}`,
      );
      const prepared = await prepareBatchImages(media.projectPath!, pending, cache);
      const prompt = await renderPrompt(paths, "batch", {
        BRAND_NAME: state.brandName,
        PRODUCT_POLICY: productEditPolicy(inputs),
        REFERENCE: safeFile(media.projectPath!, state.master),
        LOGO: await rasterLogoReference(
          media.projectPath!,
          state.logo,
          path.join(paths.root, "tmp/product-media-jobs", id, "references"),
        ),
        MASTER: safeFile(media.projectPath!, state.master),
        LOCALE: inputs.locale,
        CURRENCY: inputs.currency,
        EDITS: JSON.stringify(prepared.images),
        TRANSLATION: await readFile(
          path.join(paths.root, "agents/references/translation-prompt.md"),
          "utf8",
        ),
      });
      const response = await deps.task(
        prompt,
        media.projectPath!,
        path.join(paths.root, "agents/references/brand-batch.schema.json"),
        true,
      );
      addUsage(state, response.usage);
      await unchanged(media.projectPath!, state.selection);
      await mkdir(cache, { recursive: true });
      await writeFile(
        path.join(cache, "result.json"),
        JSON.stringify(response.result, null, 2),
      );
      if (!Array.isArray(response.result?.edits))
        throw Error("A IA não devolveu os resultados da seleção.");
      state.notes.push(...(Array.isArray(response.result.notes) ? response.result.notes : []));

      for (const asset of pending) {
        try {
          await importBatchAsset(
            media.projectPath!,
            asset,
            state.revision,
            cache,
            prepared,
            response.result.edits as BatchEdit[],
            deps.importImage,
          );
          await save(state, paths);
          if (asset.output !== asset.path)
            await unlink(safeFile(media.projectPath!, asset.path));
        } catch (error) {
          asset.error = (error as Error).message;
          state.notes.push(`${asset.path}: ${asset.error}`);
          await save(state, paths);
        }
      }

      state.status = state.selection.every((asset) => asset.status === "completed")
        ? "completed"
        : "needs_attention";
      state.message = state.status === "completed"
        ? "Branding e imagens selecionadas concluídos."
        : "Há ficheiros pendentes. Os originais e os resultados foram preservados; não haverá retry automático.";
    } catch (error) {
      state.status = "failed";
      state.message = (error as Error).message;
    } finally {
      await save(state, paths);
    }
  });
  return state;
}

async function serializedAction<T>(id: string, action: () => Promise<T>) {
  if (isBrandBusy(id)) throw Error("Já existe uma tarefa para este workflow.");
  requests.add(id);
  try {
    return await action();
  } finally {
    requests.delete(id);
  }
}
export async function prepareBrand(
  id: string,
  paths = jobPaths,
  deps = defaults,
  regenerateNames = false,
) {
  return serializedAction(id, () =>
    proposeNamesInternal(id, paths, deps, regenerateNames),
  );
}
async function proposeNamesInternal(
  id: string,
  paths: JobPaths,
  deps: BrandDependencies,
  regenerateNames = false,
) {
  const media = await getMediaJob(id, paths);
  if (!media?.projectPath || media.status !== "approved")
    throw Error("Valida primeiro as imagens.");
  const record = await readInputs(paths.inputsDir, id);
  const inputs = validateInputs(record?.inputs);
  if (!inputs.createBrand) return skipBranding(id, paths);
  const previous = await getBrandState(id, paths);
  const inputHash = digest(JSON.stringify(inputs));
  if (
    !regenerateNames &&
    previous?.status === "awaiting_name_choice" &&
    previous.inputHash === inputHash
  )
    return previous;
  if (
    regenerateNames &&
    (!previous ||
      previous.approvedAt ||
      !["awaiting_name_choice", "awaiting_approval", "failed"].includes(
        previous.status,
      ))
  )
    throw Error("Só podes pedir novos nomes antes de aprovar o branding.");
  let logoReference = previous?.logo || previous?.logoReference;
  if (!logoReference) {
    const logos = (await readdir(path.join(media.projectPath, "brand"))).filter(
      (name) => name === "logo.svg",
    );
    logos.sort(
      (a, b) => Number(b.match(/\d+/)?.[0]) - Number(a.match(/\d+/)?.[0]),
    );
    if (logos[0]) logoReference = "brand/" + logos[0];
  }
  const state: BrandState = {
    productId: id,
    status: "queued",
    revision: previous?.revision ?? 0,
    brandName: "",
    nameOptions: [],
    logoReference,
    logo: "",
    master: "",
    bundleQuantities: [],
    bundles: [],
    selection: [],
    inputHash,
    message: "A preparar três opções de marca, sem gerar imagens.",
    notes: [],
    usage: previous?.usage ?? null,
    approvedAt: null,
    updatedAt: new Date().toISOString(),
  };
  await save(state, paths);
  enqueue(id, async () => {
    try {
      state.status = "generating_names";
      await save(state, paths);
      const prompt = await renderPrompt(paths, "names", {
        CONTEXT: JSON.stringify({
          product: record?.productName,
          competitors: inputs.competitors,
          locale: inputs.locale,
          rejectedNames:
            previous?.nameOptions?.map((option) => option.name) ?? [],
        }),
      });
      const response = await deps.task(
        prompt,
        media.projectPath!,
        path.join(paths.root, "agents/references/brand-names.schema.json"),
        false,
      );
      addUsage(state, response.usage);
      const options = response.result.options;
      if (
        !Array.isArray(options) ||
        options.length !== 3 ||
        options.some(
          (o: any) =>
            typeof o.name !== "string" ||
            !o.name.trim() ||
            o.name.length > 60 ||
            typeof o.reason !== "string",
        ) ||
        new Set(options.map((o: any) => o.name.trim().toLocaleLowerCase()))
          .size !== 3 ||
        options.filter((o: any) => o.kind === "product_adaptation").length !==
          1 ||
        options.filter((o: any) => o.kind === "creative_related").length !== 2
      )
        throw Error(
          "São necessárias três marcas distintas: uma adaptação e duas relacionadas com o produto.",
        );
      state.nameOptions = options.map((o: any, i: number) => ({
        id: String(i + 1),
        name: o.name.trim(),
        kind: o.kind,
        reason: o.reason,
      }));
      state.status = "awaiting_name_choice";
      state.message =
        "Escolhe uma das três marcas para aplicar às imagens selecionadas.";
    } catch (e) {
      state.status = "failed";
      state.message = (e as Error).message;
    }
    await save(state, paths);
  });
  return state;
}
export async function chooseBrandName(
  id: string,
  optionId: unknown,
  paths = jobPaths,
  deps = defaults,
) {
  return serializedAction(id, async () => {
    const state = await getBrandState(id, paths);
    if (state?.status !== "awaiting_name_choice")
      throw Error("A escolha da marca não está disponível.");
    const option = state.nameOptions?.find((o) => o.id === optionId);
    if (!option) throw Error("Escolhe uma das opções apresentadas.");
    const record = await readInputs(paths.inputsDir, id);
    if (
      state.inputHash !== digest(JSON.stringify(validateInputs(record?.inputs)))
    )
      throw Error("Os parâmetros mudaram. Pede novas opções de marca.");
    state.selectedNameId = option.id;
    state.brandName = option.name;
    state.nameSource = "suggested";
    state.status = "awaiting_brand_creation";
    state.message =
      "Marca escolhida. Indica as quantidades para criar o logo, o product master e as bundles.";
    await save(state, paths);
    return state;
  });
}
export function normalizeBrandName(value: unknown) {
  if (typeof value !== "string") throw Error("Escreve o nome da marca.");
  const name = value
    .normalize("NFC")
    .trim()
    .replace(/(?:\s*™)+$/u, "")
    .trim();
  if (
    name.length < 2 ||
    name.length > 40 ||
    !/^\p{L}[\p{L}\p{M}\p{N}]*$/u.test(name)
  )
    throw Error(
      "Usa um nome de uma só palavra, com 2 a 40 letras ou números. O símbolo ™ é acrescentado automaticamente.",
    );
  return name;
}

/** Persist the human's name without calling any AI adapter. Image creation is a separate action. */
export async function saveCustomBrandName(
  id: string,
  value: unknown,
  paths = jobPaths,
) {
  return serializedAction(id, async () => {
    const name = normalizeBrandName(value),
      media = await getMediaJob(id, paths);
    if (
      !media?.projectPath ||
      media.status !== "approved" ||
      media.inputsChanged
    )
      throw Error("Valida primeiro a seleção de imagens.");
    const record = await readInputs(paths.inputsDir, id),
      inputs = validateInputs(record?.inputs);
    if (!inputs.createBrand)
      throw Error("Este workflow não tem branding ativado.");
    const previous = await getBrandState(id, paths);
    if (previous?.approvedAt)
      throw Error(
        "A marca já foi aprovada. Não é possível alterar o nome nesta etapa.",
      );
    let logoReference = previous?.logo || previous?.logoReference;
    if (logoReference) {
      try {
        await lstat(safeFile(media.projectPath, logoReference));
      } catch {
        logoReference = undefined;
      }
    }
    if (!logoReference) {
      const logos = (await readdir(path.join(media.projectPath, "brand")))
        .filter((n) => n === "logo.svg")
        .sort(
          (a, b) => Number(b.match(/\d+/)?.[0]) - Number(a.match(/\d+/)?.[0]),
        );
      if (logos[0]) logoReference = "brand/" + logos[0];
    }
    const state: BrandState = {
      productId: id,
      status: "awaiting_brand_creation",
      revision: previous?.revision ?? 0,
      brandName: name,
      nameSource: "user",
      selectedNameId: "custom",
      nameOptions: [],
      logoReference,
      logo: "",
      master: "",
      bundleQuantities: [],
      bundles: [],
      selection: [],
      inputHash: digest(JSON.stringify(inputs)),
      message:
        "Nome guardado sem IA. Aplica esta marca às imagens selecionadas quando quiseres.",
      notes: [],
      usage: previous?.usage ?? null,
      approvedAt: null,
      updatedAt: new Date().toISOString(),
    };
    await save(state, paths);
    return state;
  });
}
export async function createBrandFromChosenName(
  id: string,
  paths = jobPaths,
  deps = defaults,
  quantities?: unknown,
) {
  return serializedAction(id, async () => {
    const state = await getBrandState(id, paths);
    if (state?.status !== "awaiting_brand_creation")
      throw Error("Guarda primeiro o nome da marca.");
    return prepareBrandInternal(id, quantities, paths, deps);
  });
}

export async function resetBranding(
  id: string,
  paths = jobPaths,
) {
  return serializedAction(id, async () => {
    const media = await getMediaJob(id, paths);
    const previous = await getBrandState(id, paths);
    if (!media?.projectPath || media.status !== "approved" || !previous)
      throw Error("Não é possível reiniciar este branding sem a seleção e as opções de marca.");
    if (previous.approvedAt)
      throw Error("O branding já foi aprovado e não pode ser reiniciado nesta etapa.");
    if (previous.logo === "brand/logo.svg") {
      const currentLogo = safeFile(media.projectPath, previous.logo);
      const archivedLogo = safeFile(
        media.projectPath,
        `brand/logo-failed-r${previous.revision}.svg`,
      );
      try {
        await writeFile(archivedLogo, await readFile(currentLogo), { flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      await unlink(currentLogo);
    }
    const chosenName = Boolean(previous.brandName && previous.selectedNameId);
    const state: BrandState = {
      productId: id,
      status: chosenName ? "awaiting_brand_creation" : "awaiting_name_choice",
      revision: previous.revision,
      brandName: chosenName ? previous.brandName : "",
      nameOptions: previous.nameOptions,
      ...(chosenName
        ? {
            selectedNameId: previous.selectedNameId,
            nameSource: previous.nameSource,
          }
        : {}),
      logo: "",
      master: "",
      bundleQuantities: previous.bundleQuantities,
      bundles: [],
      selection: [],
      inputHash: previous.inputHash,
      message: chosenName
        ? "Marca escolhida preservada. Confirma as quantidades e volta a criar o logo, master e bundles."
        : "Branding reiniciado. Escolhe novamente uma marca para gerar o logo e as bundles.",
      notes: [],
      usage: previous.usage,
      approvedAt: null,
      updatedAt: new Date().toISOString(),
    };
    await save(state, paths);
    return state;
  });
}
export async function approveBrand(
  id: string,
  quantities: unknown,
  paths = jobPaths,
  deps = defaults,
  retry = false,
) {
  return serializedAction(id, () =>
    approveBrandBatchInternal(id, quantities, paths, deps, retry),
  );
}
