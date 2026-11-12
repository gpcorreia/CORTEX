import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readInputs, validateInputs } from "./inputs.js";
import { getMediaJob, type JobPaths } from "./mediaJobs.js";
import { getBrandState } from "./branding.js";
import { classifyTextBlocks, readPageCaptures } from "./funnelCapture.js";

const sha = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/**
 * Translation requires valid inputs, an approved download and both captured
 * pages. Brand & Media is deliberately optional: a chosen name may guide text
 * substitution, but unfinished image generation never blocks translation.
 */
export async function buildTranslationContext(id: string, paths: JobPaths) {
  const record = await readInputs(paths.inputsDir, id);
  const inputs = validateInputs(record?.inputs);
  const media = await getMediaJob(id, paths);
  const brand = await getBrandState(id, paths);

  if (!media?.projectPath || media.status !== "approved" || media.inputsChanged)
    throw Error("Conclui o download e a revisão dos ficheiros primeiro.");

  const pages = (await readPageCaptures(media.projectPath)).filter((page) => {
    if (page.competitor > inputs.competitors.length) return false;
    const expected = inputs.competitors[page.competitor - 1][
      page.page === "advertorial" ? "advertorialUrl" : "salesPageUrl"
    ];
    return (page.capture.requestedUrl ?? page.capture.url).split("#")[0] ===
      expected.split("#")[0];
  }).map((page) => ({ ...page, capture: classifyTextBlocks(page.capture) }));
  if (pages.length !== inputs.competitors.length * 2)
    throw Error(
      "Falta a estrutura de uma ou mais páginas. Usa Recolher estrutura em falta (sem IA).",
    );

  // Media is excluded on purpose. Repairing an image must not invalidate text.
  const translationInstructions = await Promise.all([
    readFile(
      path.join(paths.root, "agents/references/translation-prompt.md"),
      "utf8",
    ),
    readFile(
      path.join(paths.root, "agents/prompts/03-translation-execution.md"),
      "utf8",
    ),
  ]);
  const fingerprint = sha(
    JSON.stringify({
      locale: inputs.locale,
      currency: inputs.currency,
      brandName: brand?.brandName ?? "",
      instructions: translationInstructions.map(sha),
      pages: pages.map((page) => [
        page.competitor,
        page.page,
        page.capture,
      ]),
    }),
  );

  return {
    inputs,
    media,
    brand,
    pages,
    fingerprint,
    project: media.projectPath,
    brandingReady: !inputs.createBrand || brand?.status === "completed",
  };
}

