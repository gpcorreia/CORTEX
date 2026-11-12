// Convert exactly one generated master to WebP. Does not touch generator selections.
import fs from "node:fs/promises";
import path from "node:path";
import { normalizedWebp } from "../backend/tools/normalizeImage.mjs";
import { fileURLToPath } from "node:url";
const [source, target, reference] = process.argv.slice(2);
if (!source || !target) throw Error("Usage: source target");
const cwd = await fs.realpath(process.cwd()),
  destination = path.resolve(target);
const jobsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../tmp/product-media-jobs",
);
const frameOutput =
  cwd.startsWith(jobsRoot + path.sep) && path.dirname(destination) === cwd;
if (
  (!frameOutput &&
    ![
      path.join(cwd, "brand"),
      path.join(cwd, "advertorial", "generator"),
      path.join(cwd, "content", "generator"),
    ].includes(path.dirname(destination))) ||
  !destination.endsWith(".webp")
)
  throw Error("Target must be inside this product brand/generator directory.");
const bytes = await fs.readFile(source);
await fs.writeFile(
  destination,
  await normalizedWebp(
    bytes,
    reference ? await fs.readFile(reference) : undefined,
  ),
  { flag: "wx" },
);
