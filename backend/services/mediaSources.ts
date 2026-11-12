import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";

interface SourceAsset {
  path: string;
  source: string;
  hash: string;
}
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function inside(project: string, relative: string) {
  const full = path.resolve(project, relative);
  if (!full.startsWith(path.resolve(project) + path.sep))
    throw Error("Origem fora do projeto.");
  return full;
}

// Recover a deleted backup locally only from the exact, hash-approved generator original.
// Never use an adapted output or overwrite an existing (possibly changed) backup.
export async function ensureSourceBackup(project: string, asset: SourceAsset) {
  const destination = inside(project, asset.source);
  try {
    if (digest(await readFile(destination)) !== asset.hash)
      throw Error(
        "A cópia de origem foi alterada; revê esta imagem antes de continuar.",
      );
    return false;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const original = await readFile(inside(project, asset.path));
  if (digest(original) !== asset.hash)
    throw Error(
      "O original do generator mudou; não é possível repor a cópia aprovada.",
    );
  try {
    await writeFile(destination, original, { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    if (digest(await readFile(destination)) !== asset.hash)
      throw Error("A cópia de origem está em conflito.");
  }
  return true;
}

// Image-generation references must be raster images; rendering an approved SVG is local conversion, not new branding.
export async function rasterLogoReference(
  project: string,
  logo: string,
  workDir: string,
) {
  const source = inside(project, logo);
  const bytes = await readFile(source);
  if (path.extname(logo).toLowerCase() !== ".svg") return source;
  await mkdir(workDir, { recursive: true });
  const output = path.join(
    workDir,
    `approved-logo-${digest(bytes).slice(0, 24)}.webp`,
  );
  try {
    const cached = await readFile(output);
    if ((await sharp(cached).metadata()).format !== "webp")
      throw Error("A referência raster do logo é inválida.");
    return output;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const rendered = await sharp(bytes, { density: 288 })
    .webp({ lossless: true })
    .toBuffer();
  try {
    await writeFile(output, rendered, { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  return output;
}
