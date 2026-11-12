import { mkdir, readFile, writeFile, access, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { workspaceRoot, config } from "../config.js";
import { readInputs, validateInputs, type Inputs } from "./inputs.js";
import { convertProjectImagesToWebp } from "../tools/images.js";
import { savePageCapture } from "./funnelCapture.js";
import {
  discoverMedia,
  downloadMedia,
  imageFormat,
  animationInfo,
  type DownloadedMedia,
} from "./mediaCollector.js";
export interface MediaJob {
  productId: string;
  productName?: string;
  stage: 2;
  phase: "download" | "review";
  status: "running" | "awaiting_review" | "approved" | "failed";
  projectPath: string | null;
  summary: string;
  limitations: string[];
  assets: DownloadedMedia[];
  reviewVersion: number;
  inputHash: string;
  downloadHash?: string;
  startedAt: string;
  updatedAt: string;
  usage: null;
  inputsChanged?: boolean;
}
export interface JobPaths {
  root: string;
  inputsDir: string;
  stateDir: string;
  projectsDir: string;
}
export const jobPaths: JobPaths = {
  root: workspaceRoot,
  inputsDir: config.dataDir,
  stateDir: path.join(workspaceRoot, "data/workflows"),
  projectsDir: path.join(workspaceRoot, "projects"),
};
const active = new Set<string>(),
  writes = new Map<string, Promise<void>>();
const validateId = (id: string) => {
  if (!/^[a-f0-9]{24}$/.test(id)) throw new Error("Identificador inválido.");
};
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const downloadHash = (inputs: Inputs) =>
  hash({ competitors: inputs.competitors, locale: inputs.locale });
export async function persistJob(job: MediaJob, paths = jobPaths) {
  await mkdir(paths.stateDir, { recursive: true });
  job.updatedAt = new Date().toISOString();
  const file = path.join(paths.stateDir, job.productId + ".json"),
    content = JSON.stringify(job, null, 2);
  const pending = (writes.get(file) ?? Promise.resolve())
    .catch(() => {})
    .then(() => writeFile(file, content));
  writes.set(file, pending);
  await pending;
}
export async function getMediaJob(
  id: string,
  paths = jobPaths,
): Promise<MediaJob | null> {
  validateId(id);
  const file = path.join(paths.stateDir, id + ".json");
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
    const job = JSON.parse(await reading) as MediaJob;
    if (job.status === "running" && !active.has(id)) {
      job.status = "failed";
      job.summary = "Recolha interrompida. Podes tentar novamente.";
      await persistJob(job, paths);
    }
    const saved = await readInputs(paths.inputsDir, id);
    try {
      if (saved) {
        const inputs = validateInputs(saved.inputs);
        job.inputsChanged = job.downloadHash
          ? downloadHash(inputs) !== job.downloadHash
          : hash(inputs) !== job.inputHash &&
            hash({ ...inputs, productImage: null }) !== job.inputHash;
      } else job.inputsChanged = false;
    } catch {
      job.inputsChanged = true;
    }
    return job;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
export interface MediaDependencies {
  discover: typeof discoverMedia;
  download: typeof downloadMedia;
}
const dependencies: MediaDependencies = {
  discover: discoverMedia,
  download: downloadMedia,
};
function slug(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 85) || "product"
  );
}
async function reserve(root: string, name: string) {
  await mkdir(root, { recursive: true });
  for (let i = 1; i < 1000; i++) {
    const directory = path.join(root, name + (i === 1 ? "" : `-${i}`));
    try {
      await mkdir(directory);
      return directory;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  throw new Error("Não foi possível criar a pasta do produto.");
}
async function structure(project: string) {
  for (const directory of [
    "ads/copy",
    "ads/generator",
    "advertorial/copy",
    "advertorial/generator",
    "brand",
    "content/copy",
    "content/generator",
  ])
    await mkdir(path.join(project, directory), { recursive: true });
  try {
    await access(path.join(project, "ads/creative_strategy.md"));
  } catch {
    await writeFile(path.join(project, "ads/creative_strategy.md"), "");
  }
}
export async function startDownload(
  id: string,
  paths = jobPaths,
  deps = dependencies,
  productName = "",
  rescan = false,
) {
  validateId(id);
  if (active.has(id))
    throw new Error("Este produto já tem uma recolha em curso.");
  if (active.size >= config.maxConcurrentDownloads)
    throw new Error(
      `Já existem ${config.maxConcurrentDownloads} downloads em curso. Aguarda uma vaga.`,
    );
  active.add(id);
  try {
    const previous = await getMediaJob(id, paths);
    const record = await readInputs(paths.inputsDir, id);
    if (!record) throw new Error("Guarda os inputs.");
    const inputs = validateInputs(record.inputs);
    if (
      previous &&
      previous.status !== "failed" &&
      previous.inputHash === hash(inputs) &&
      !rescan
    )
      throw new Error(
        "As imagens já foram descarregadas. Revê as pastas e confirma o OK.",
      );
    const job: MediaJob = {
      productId: id,
      productName: productName || record.productName,
      stage: 2,
      phase: "download",
      status: "running",
      projectPath: null,
      summary: "A identificar imagens e GIFs. Sem IA.",
      limitations: [],
      assets: [],
      reviewVersion: 0,
      inputHash: hash(inputs),
      downloadHash: downloadHash(inputs),
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usage: null,
    };
    await persistJob(job, paths);
    void (async () => {
      try {
        const name =
          productName || new URL(inputs.competitors[0].salesPageUrl).hostname;
        job.projectPath =
          previous?.projectPath &&
          path
            .basename(previous.projectPath)
            .includes("-" + inputs.locale.toLowerCase())
            ? previous.projectPath
            : await reserve(
                paths.projectsDir,
                `${slug(name)}-${inputs.locale.toLowerCase()}`,
              );
        await structure(job.projectPath);
        if (previous?.projectPath === job.projectPath) {
          for (const asset of previous.assets) {
            try {
              await access(path.join(job.projectPath, asset.original));
              job.assets.push(asset);
            } catch {}
          }
        }
        await writeFile(
          path.join(job.projectPath, "product.md"),
          `# ${name}\n\nLocale: ${inputs.locale}\nCurrency: ${inputs.currency}\nNew brand requested: ${inputs.createBrand}\n${inputs.competitors.map((c, i) => `Competitor ${i + 1}:\nAdvertorial: ${c.advertorialUrl}\nSales page: ${c.salesPageUrl}`).join("\n\n")}\n\nOriginal media only. Awaiting manual review. No AI execution.\n`,
        );
        if (inputs.productImage) {
          const ext = inputs.productImage.startsWith("data:image/png")
            ? "png"
            : inputs.productImage.startsWith("data:image/jpeg")
              ? "jpg"
              : "webp";
          await writeFile(
            path.join(job.projectPath, `brand/reference.${ext}`),
            Buffer.from(inputs.productImage.split(",")[1], "base64"),
          );
        }
        for (const [index, competitor] of inputs.competitors.entries()) {
          for (const [role, url] of [
            ["advertorial", competitor.advertorialUrl],
            ["content", competitor.salesPageUrl],
          ] as const) {
            job.summary = `Concorrente ${index + 1}/${inputs.competitors.length} · ${role === "content" ? "Sales Page" : "Advertorial"}`;
            await persistJob(job, paths);
            try {
              const page = await deps.discover(url);
              if (page.capture)
                await savePageCapture(job.projectPath, index + 1, role, {
                  ...page.capture,
                  requestedUrl: url,
                });
              if (page.captureError)
                job.limitations.push(
                  `Concorrente ${index + 1}, estrutura ${role}: ${page.captureError}`,
                );
              const result = await deps.download(
                job.projectPath,
                role,
                page.assets,
                (text) => {
                  job.summary = text;
                },
              );
              for (const asset of result.assets) {
                const source = { competitor: index + 1, url: asset.sourceUrl };
                const existing = job.assets.find((a) => a.id === asset.id);
                if (existing) {
                  Object.assign(existing, {
                    original: asset.original,
                    animated: asset.animated,
                    frameCount: asset.frameCount,
                  });
                  if (
                    !existing.sources?.some(
                      (s) =>
                        s.competitor === source.competitor &&
                        s.url === source.url,
                    )
                  )
                    existing.sources = [...(existing.sources ?? []), source];
                } else
                  job.assets.push({
                    ...asset,
                    competitor: index + 1,
                    sources: [source],
                  });
              }
              job.limitations.push(
                ...result.failures.map((f) => `Concorrente ${index + 1}: ${f}`),
              );
            } catch (e) {
              job.limitations.push(
                `Concorrente ${index + 1}, ${role}: ${(e as Error).message}`,
              );
            }
            await persistJob(job, paths);
          }
        }
        job.summary =
          "Download concluído. A converter imagens estáticas para WebP localmente, sem IA.";
        await persistJob(job, paths);
        const conversion = await convertProjectImagesToWebp(job.projectPath);
        for (const asset of job.assets) {
          const converted = conversion.converted.find(
            (item) => item.source === asset.original,
          );
          if (converted)
            Object.assign(asset, {
              original: converted.output,
              downloadedOriginal: converted.archivedOriginal,
              downloadedHash: converted.sourceHash,
              hash: converted.hash,
              format: "webp",
              width: converted.width,
              height: converted.height,
            });
        }
        job.limitations.push(
          ...conversion.failures.map((message) => "Conversão WebP: " + message),
        );
        await writeFile(
          path.join(job.projectPath, "content/manifest.json"),
          JSON.stringify(job.assets, null, 2),
        );
        job.phase = "review";
        job.status = "awaiting_review";
        job.reviewVersion = (previous?.reviewVersion ?? 0) + 1;
        job.summary = `${job.assets.length} imagens guardadas; ${conversion.converted.length} convertidas localmente para WebP; ${job.assets.filter((a) => a.animated).length} animações (GIF/WebP) preservadas.${job.limitations.length ? " " + job.limitations.length + " limitações; consulta os detalhes." : ""} Revê as pastas copy, apaga o que não queres e confirma o OK.`;
      } catch (e) {
        job.status = "failed";
        job.summary = (e as Error).message;
      } finally {
        try {
          await persistJob(job, paths);
        } finally {
          active.delete(id);
        }
      }
    })();
    return job;
  } catch (e) {
    active.delete(id);
    throw e;
  }
}
export async function approveMedia(id: string, paths = jobPaths) {
  const job = await getMediaJob(id, paths);
  if (!job || job.status !== "awaiting_review" || !job.projectPath)
    throw new Error("A recolha não está pronta para revisão.");
  const original = new Map(job.assets.map((a) => [a.original, a]));
  const kept: DownloadedMedia[] = [];
  for (const page of ["advertorial", "content"] as const) {
    const directory = path.join(job.projectPath, page, "copy");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const relative = `${page}/copy/${entry.name}`;
      const bytes = await readFile(path.join(directory, entry.name));
      const format = imageFormat(bytes);
      if (!format) continue;
      const digest = createHash("sha256").update(bytes).digest("hex");
      const known = original.get(relative);
      kept.push({
        ...known,
        id: known?.id ?? `${page}-${digest.slice(0, 16)}`,
        page,
        role: known?.role ?? "section",
        sourceUrl: known?.sourceUrl ?? "",
        original: relative,
        width: known?.width ?? 0,
        height: known?.height ?? 0,
        format,
        hash: digest,
        ...animationInfo(bytes, format),
        selected: true,
        action: "keep",
        output: null,
        status: "downloaded",
      });
    }
  }
  if (!kept.length)
    throw new Error(
      "Não há imagens nas pastas copy. Mantém pelo menos uma antes de confirmar.",
    );
  job.assets = kept;
  job.status = "approved";
  job.summary = `Revisão confirmada: ${kept.length} imagens/GIFs. A fase de IA será implementada depois.`;
  await writeFile(
    path.join(job.projectPath, "content/manifest.json"),
    JSON.stringify(kept, null, 2),
  );
  await persistJob(job, paths);
  return job;
}
