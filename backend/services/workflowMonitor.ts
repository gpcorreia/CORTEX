import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { readInputs, validateInputs } from "./inputs.js";
import {
  getMediaJob,
  startDownload,
  approveMedia,
  jobPaths,
  type JobPaths,
  type MediaDependencies,
} from "./mediaJobs.js";
import {
  getBrandState,
  prepareBrand,
  skipBranding,
  selectedImages,
  saveCustomBrandName,
  normalizeBrandName,
  type BrandDependencies,
} from "./branding.js";
import { translationInfo } from "./siteTranslation.js";
export async function workflowView(id: string, paths = jobPaths) {
  const record = await readInputs(paths.inputsDir, id);
  if (!record) return null;
  const media = await getMediaJob(id, paths),
    brand = await getBrandState(id, paths);
  let inputError = "";
  try {
    validateInputs(record.inputs);
  } catch (e) {
    inputError = (e as Error).message;
  }
  const branding = record.inputs.createBrand === true;
  const translation = await translationInfo(id, paths);
  const brandInputsChanged = Boolean(
    branding &&
    brand &&
    (!brand.inputHash ||
      (!inputError &&
        createHash("sha256")
          .update(JSON.stringify(validateInputs(record.inputs)))
          .digest("hex") !== brand.inputHash)),
  );
  const stages = [
    {
      id: 1,
      name: "Parâmetros",
      status: inputError ? "needs_attention" : "completed",
      description: inputError || "Inputs guardados e validados.",
    },
    {
      id: 2,
      name: "Download",
      status:
        media?.inputsChanged && media.status !== "running"
          ? "ready"
          : media?.status === "running"
            ? "running"
            : media?.status === "failed"
              ? "failed"
              : media?.status === "awaiting_review"
                ? "pending_validation"
                : media?.status === "approved"
                  ? "completed"
                  : "ready",
      description: media?.summary || "Download de imagens e GIFs, sem IA.",
    },
    {
      id: 3,
      name: "Brand & Media",
      status: media?.inputsChanged
        ? "blocked"
        : brandInputsChanged
          ? "ready"
          : !branding && media?.status === "approved"
            ? "skipped"
            : [
                  "awaiting_approval",
                  "awaiting_name_choice",
                  "awaiting_brand_creation",
                ].includes(brand?.status ?? "")
              ? "pending_validation"
              : [
                    "queued",
                    "generating_names",
                    "preparing",
                    "adapting",
                  ].includes(brand?.status ?? "")
                ? "running"
                : brand?.status === "completed"
                  ? "completed"
                  : ["failed", "needs_attention"].includes(brand?.status ?? "")
                    ? "needs_attention"
                    : media?.status === "approved"
                      ? "ready"
                      : "blocked",
      description:
        (brandInputsChanged
          ? "Os parâmetros de branding mudaram. Valida novamente a seleção."
          : brand?.message) ||
        (branding
          ? "Criar marca e master, aprovar, depois adaptar a seleção."
          : "Sem branding: manter produto e imagens, sem IA."),
    },
    {
      id: 4,
      name: "Text Translation",
      status: translation.inputError
        ? "blocked"
        : translation.stale
          ? "ready"
          : translation.previewsChanged
            ? "pending_validation"
            : translation.state?.status === "completed"
              ? "completed"
              : translation.state?.status === "awaiting_review"
                ? "pending_validation"
                : ["queued", "running"].includes(
                      translation.state?.status ?? "",
                    )
                  ? "running"
                  : translation.state?.status === "failed"
                    ? "needs_attention"
                    : "ready",
      description:
        translation.inputError ||
        translation.state?.message ||
        "Traduzir textos e rever o site local nesta sessão.",
    },
    {
      id: 5,
      name: "Funnelish",
      status: "planned",
      description: "Por implementar.",
    },
  ];
  const status = inputError
    ? "needs_attention"
    : stages.some((s) => s.status === "running")
      ? "running"
      : stages.some((s) => s.status === "pending_validation")
        ? "pending_validation"
        : stages.some((s) => ["failed", "needs_attention"].includes(s.status))
          ? "needs_attention"
          : stages[3].status === "completed"
            ? "awaiting_implementation"
            : "ready";
  let selectionCount = 0;
  if (media?.projectPath)
    for (const page of ["advertorial", "content"])
      selectionCount += (
        await readdir(path.join(media.projectPath, page, "generator"), {
          withFileTypes: true,
        }).catch(() => [])
      ).filter(
        (f) => f.isFile() && /\.(webp|gif|png|jpe?g|avif)$/i.test(f.name),
      ).length;
  return {
    id,
    productName:
      record.productName ||
      media?.productName ||
      (media?.projectPath
        ? path.basename(media.projectPath)
        : `Produto ${id.slice(0, 8)}`),
    status,
    stages,
    progress: Math.round(
      (stages.filter((s) => ["completed", "skipped"].includes(s.status))
        .length /
        stages.length) *
        100,
    ),
    updatedAt:
      translation.state?.updatedAt ||
      brand?.updatedAt ||
      media?.updatedAt ||
      record.savedAt,
    projectPath: media?.projectPath ?? null,
    createBrand: branding,
    locale: record.inputs.locale,
    currency: record.inputs.currency,
    competitorCount: record.inputs.competitors?.length ?? 1,
    hasProductImage: Boolean(record.inputs.productImage),
    inputError,
    brandInputsChanged,
    media: media
      ? {
          status: media.status,
          summary: media.summary,
          count: media.assets.length,
          limitations: media.limitations,
          inputsChanged: media.inputsChanged,
        }
      : null,
    selectionCount,
    brand,
    translation,
  };
}
export async function listWorkflows(paths = jobPaths) {
  const files = await readdir(paths.inputsDir).catch(() => []);
  const views = await Promise.all(
    files
      .filter((n) => /^[a-f0-9]{24}\.json$/.test(n))
      .map((n) => workflowView(n.slice(0, -5), paths)),
  );
  return views
    .filter(Boolean)
    .map((v) => ({
      id: v!.id,
      productName: v!.productName,
      status: v!.status,
      progress: v!.progress,
      updatedAt: v!.updatedAt,
      locale: v!.locale,
      createBrand: v!.createBrand,
      currentStep:
        v!.stages.find((s) =>
          [
            "running",
            "pending_validation",
            "needs_attention",
            "failed",
            "ready",
          ].includes(s.status),
        )?.name ?? "Etapas futuras",
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function startWorkflow(
  id: string,
  productName: string,
  paths = jobPaths,
  deps?: MediaDependencies,
) {
  const record = await readInputs(paths.inputsDir, id);
  if (!record) throw Error("Guarda os inputs primeiro.");
  validateInputs(record.inputs);
  const current = await getMediaJob(id, paths);
  if (current && !current.inputsChanged && current.status !== "failed")
    return workflowView(id, paths);
  await startDownload(id, paths, deps, productName);
  return workflowView(id, paths);
}
export async function validateWorkflowMedia(
  id: string,
  paths = jobPaths,
  brandDeps?: BrandDependencies,
  customBrandName?: unknown,
) {
  const record = await readInputs(paths.inputsDir, id),
    inputs = validateInputs(record?.inputs);
  if (customBrandName !== undefined) normalizeBrandName(customBrandName);
  const media = await getMediaJob(id, paths);
  if (media?.inputsChanged)
    throw Error(
      "Os links ou o mercado mudaram. Inicia a recolha com os novos parâmetros.",
    );
  if (
    !media?.projectPath ||
    !["awaiting_review", "approved"].includes(media.status)
  )
    throw Error("Espera pelo fim do download.");
  if (inputs.createBrand && !(await selectedImages(media.projectPath)).length)
    throw Error(
      "Coloca as imagens escolhidas nas pastas generator antes de validar.",
    );
  if (media.status === "awaiting_review") await approveMedia(id, paths);
  if (inputs.createBrand && customBrandName !== undefined)
    await saveCustomBrandName(id, customBrandName, paths);
  else if (inputs.createBrand) await prepareBrand(id, paths, brandDeps);
  else await skipBranding(id, paths);
  return workflowView(id, paths);
}
