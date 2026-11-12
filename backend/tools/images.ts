import sharp from "sharp";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  unlink,
  realpath,
  lstat,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { normalizedWebp } from "./normalizeImage.mjs";

const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const rasterExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".avif",
  ".tif",
  ".tiff",
]);

async function webpBytes(bytes: Buffer, reference?: string) {
  return normalizedWebp(
    bytes,
    reference ? await readFile(reference) : undefined,
  );
}

/** Local conversion only. Never overwrites an existing destination. */
export async function convertImageToWebp(
  source: string,
  destination: string,
  reference?: string,
) {
  if (path.extname(destination).toLowerCase() !== ".webp")
    throw Error("O destino tem de ser WebP.");
  const output = await webpBytes(await readFile(source), reference);
  await writeFile(destination, output, { flag: "wx" });
}

/** Import only actual image-tool outputs; the model never needs to run a converter. */
export async function importGeneratedImage(
  source: string,
  destination: string,
  reference?: string,
  generatedRoots?: string[],
) {
  const full = await realpath(source);
  const roots = generatedRoots ?? [
    ...new Set([
      path.join(os.homedir(), ".codex/generated_images"),
      ...(process.env.CODEX_HOME
        ? [path.join(process.env.CODEX_HOME, "generated_images")]
        : []),
    ]),
  ];
  let allowed = false;
  for (const root of roots) {
    try {
      if (full.startsWith((await realpath(root)) + path.sep)) allowed = true;
    } catch {}
  }
  if (!allowed)
    throw Error(
      "O resultado não pertence ao diretório de imagens geradas da ferramenta.",
    );
  await convertImageToWebp(full, destination, reference);
}

export interface WebpConversion {
  source: string;
  output: string;
  archivedOriginal: string;
  sourceHash: string;
  hash: string;
  width: number;
  height: number;
}
export interface WebpReport {
  converted: WebpConversion[];
  failures: string[];
}

async function saveUnique(directory: string, name: string, bytes: Buffer) {
  await mkdir(directory, { recursive: true });
  const ext = path.extname(name),
    stem = name.slice(0, -ext.length);
  for (let n = 1; n < 10000; n++) {
    const destination = path.join(
      directory,
      n === 1 ? name : `${stem} (${n})${ext}`,
    );
    try {
      await writeFile(destination, bytes, { flag: "wx" });
      return destination;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if ((await readFile(destination)).equals(bytes)) return destination;
    }
  }
  throw Error("Não foi possível reservar um nome para a imagem.");
}

/** Convert this project's working images after download; archives and backups are immutable. */
export async function convertProjectImagesToWebp(
  project: string,
): Promise<WebpReport> {
  const root = await realpath(project),
    report: WebpReport = { converted: [], failures: [] };
  const relative = (file: string) =>
    path.relative(root, file).split(path.sep).join("/");
  const archiveRoot = path.join(root, "content/originals");
  async function walk(directory: string) {
    let entries;
    try {
      if (!(await realpath(directory)).startsWith(root + path.sep))
        throw Error("Diretório fora do projeto.");
      if ((await lstat(directory)).isSymbolicLink()) return;
      entries = await readdir(directory, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(file);
        continue;
      }
      if (
        !entry.isFile() ||
        entry.name.startsWith("selected-") ||
        !rasterExtensions.has(path.extname(entry.name).toLowerCase())
      )
        continue;
      try {
        const bytes = await readFile(file),
          metadata = await sharp(bytes).metadata();
        if ((metadata.pages ?? 1) > 1) continue;
        const converted = await webpBytes(bytes);
        const verified = await sharp(converted).metadata();
        const lostTransparency =
          metadata.hasAlpha &&
          !verified.hasAlpha &&
          (
            await sharp(bytes)
              .ensureAlpha()
              .extractChannel("alpha")
              .raw()
              .toBuffer()
          ).some((alpha) => alpha < 255);
        if (
          verified.width !== metadata.width ||
          verified.height !== metadata.height ||
          lostTransparency
        )
          throw Error(
            "A conversão não preservou as dimensões ou transparência.",
          );
        const target = await saveUnique(
          directory,
          path.parse(file).name + ".webp",
          converted,
        );
        const archiveDirectory = path.join(
          archiveRoot,
          path.dirname(relative(file)),
        );
        let parent = root;
        for (const segment of path
          .relative(root, archiveDirectory)
          .split(path.sep)) {
          parent = path.join(parent, segment);
          try {
            if ((await lstat(parent)).isSymbolicLink())
              throw Error(
                "O arquivo de originais não pode usar ligações simbólicas.",
              );
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") break;
            throw e;
          }
        }
        const archived = await saveUnique(archiveDirectory, entry.name, bytes);
        // Recheck before removing the working original, in case the user changed it mid-conversion.
        if (!(await readFile(file)).equals(bytes))
          throw Error("A origem mudou durante a conversão.");
        await unlink(file);
        report.converted.push({
          source: relative(file),
          output: relative(target),
          archivedOriginal: relative(archived),
          sourceHash: digest(bytes),
          hash: digest(converted),
          width: verified.width!,
          height: verified.height!,
        });
      } catch (e) {
        report.failures.push(`${relative(file)}: ${(e as Error).message}`);
      }
    }
  }
  // Explicit scopes prevent touching archives, runtime files or unrelated projects.
  for (const folder of [
    "ads/copy",
    "ads/generator",
    "advertorial/copy",
    "advertorial/generator",
    "content/copy",
    "content/generator",
    "brand",
    "branding",
  ])
    await walk(path.join(root, folder));
  return report;
}
