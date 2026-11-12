import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { adaptAnimation } from "./animation.js";
import { importGeneratedImage } from "../tools/images.js";
import type { SelectedAsset } from "./branding.js";

export interface BatchImage { path: string; source: string; width: number; height: number }
export interface BatchEdit { path: string; output: string | null; status: "completed" | "keep" | "pending" }

// Animations expose only their first composited frame to the single agent request.
// adaptAnimation reuses that edit only when every changed pixel is invariant in
// the complete source animation; otherwise it keeps the animation pending.
export async function prepareBatchImages(project: string, selection: SelectedAsset[], cache: string) {
  const images: BatchImage[] = [];
  const frames = new Map<string, BatchImage[]>();
  await mkdir(cache, { recursive: true });
  for (const asset of selection) {
    const source = path.resolve(project, asset.source);
    const bytes = await readFile(source);
    const meta = await sharp(bytes, { animated: true }).metadata();
    if (!asset.animated) {
      images.push({ path: asset.path, source, width: meta.width!, height: meta.height! });
      continue;
    }
    const count = meta.pages ?? 1, width = meta.width!, height = meta.pageHeight ?? meta.height!;
    if (width * height * count > 128_000_000) throw Error("Animação demasiado grande.");
    const raw = await sharp(bytes, { page: 0, pages: 1 }).ensureAlpha().raw().toBuffer();
    const hash = createHash("sha256").update(raw).digest("hex");
    const file = path.join(cache, `${hash}.webp`);
    await writeFile(file, await sharp(raw, { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toBuffer());
    const entry = { path: `${asset.path}#0`, source: file, width, height };
    images.push(entry);
    frames.set(asset.path, Array.from({ length: count }, () => entry));
  }
  return { images, frames };
}

export async function importBatchAsset(
  project: string, asset: SelectedAsset, revision: number, cache: string,
  prepared: Awaited<ReturnType<typeof prepareBatchImages>>, edits: BatchEdit[],
  importImage = importGeneratedImage,
) {
  const entries = prepared.frames.get(asset.path) ?? prepared.images.filter((image) => image.path === asset.path);
  const result = (entry: BatchImage) => {
    const matches = edits.filter((edit) => edit.path === entry.path);
    if (matches.length !== 1 || !["keep", "completed"].includes(matches[0].status))
      throw Error("Imagem pendente ou resultado em falta: " + entry.path);
    return matches[0];
  };
  if (entries.every((entry) => result(entry).status === "keep")) {
    asset.action = "keep";
    asset.output = asset.path;
    asset.status = "completed";
    return;
  }
  const output = asset.path.slice(0, -path.extname(asset.path).length) + `-branded-r${revision}.${asset.animated ? asset.format : "webp"}`;
  const target = path.resolve(project, output);
  const importEntry = async (entry: BatchImage, destination: string) => {
    const edit = result(entry);
    if (edit.status === "keep") await writeFile(destination, await readFile(entry.source));
    else {
      if (typeof edit.output !== "string" || !edit.output) throw Error("Ficheiro gerado em falta.");
      await importImage(path.resolve(project, edit.output), destination, entry.source);
    }
  };
  if (asset.animated) {
    await adaptAnimation(path.resolve(project, asset.source), target,
      path.join(cache, createHash("sha256").update(asset.path).digest("hex")),
      async (_source, destination, index) => {
        if (index > 0)
          throw Error("A alteração não pertence a uma região estática da animação.");
        await importEntry(entries[0], destination);
        return true;
      });
  } else await importEntry(entries[0], target);
  asset.action = "both";
  asset.output = output;
  asset.status = "completed";
}
