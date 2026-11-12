import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Inputs } from "./inputs.js";

/** Reuses a downloaded product photograph; never generates or substitutes a product. */
export async function prepareProductReference(
  project: string,
  revision: number,
  inputs: Inputs,
  assets: { role: string; original: string; animated?: boolean }[],
  selection: { source: string; animated?: boolean }[] = [],
) {
  let bytes: Buffer | undefined;
  if (inputs.productImage) {
    bytes = Buffer.from(inputs.productImage.split(",")[1], "base64");
  } else {
    if (!inputs.sameProduct) throw Error("Falta a fotografia do produto.");
    const approved = selection.map((asset) => ({ role: "selected", original: asset.source, animated: asset.animated }));
    const candidates = [
      ...assets.filter((asset) => asset.role === "product"),
      ...approved.filter((asset) => asset.original.startsWith("content/")),
      ...assets.filter((asset) => asset.original.startsWith("content/")),
      ...approved,
      ...assets,
    ];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (candidate.animated || seen.has(candidate.original)) continue;
      seen.add(candidate.original);
      const full = path.resolve(project, candidate.original);
      if (!full.startsWith(path.resolve(project) + path.sep)) throw Error("Referência fora do projeto.");
      let content: Buffer;
      try { content = await readFile(full); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      try {
        const info = await sharp(content).metadata();
        if ((info.pages ?? 1) !== 1) continue;
      } catch { continue; }
      bytes = content;
      break;
    }
    if (!bytes) throw Error("Não existem imagens estáticas disponíveis nos downloads ou na seleção. Coloca uma das imagens descarregadas do produto em content/generator e tenta novamente.");
  }
  const metadata = await sharp(bytes).metadata();
  if ((metadata.pages ?? 1) !== 1) throw Error("A referência do produto deve ser uma imagem estática.");
  const reference = `brand/reference-r${revision}.webp`;
  await writeFile(path.join(project, reference), await sharp(bytes).webp({ lossless: true }).toBuffer(), { flag: "wx" });
  return reference;
}

export function productEditPolicy(inputs: Inputs) {
  return inputs.sameProduct
    ? "Same product: preserve geometry, packaging, placement and unmarked surfaces; edit only existing brands and necessary translations. An unbranded product without text to localize MUST be keep. Identify the product from the selected references; reuse its unchanged source as master when suitable, without generation or forced transparency."
    : "Use the uploaded product photo and approved master for replacement; preserve product specifications.";
}
