import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { imageFormat } from "./mediaCollector.js";
export async function createBundles(
  project: string,
  master: string,
  quantities: number[],
  revision: number,
) {
  if (
    !quantities.length ||
    quantities.some((n) => !Number.isInteger(n) || n < 1 || n > 12)
  )
    throw Error("Indica as quantidades das ofertas (1 a 12 unidades).");
  const bytes = await readFile(path.join(project, master));
  const browser = await chromium.launch({ channel: "chrome" });
  const outputs: { quantity: number; path: string }[] = [];
  try {
    const page = await browser.newPage();
    for (const quantity of [...new Set(quantities)]) {
      const existing = `brand/pack-${quantity}-r${revision}.webp`;
      try {
        const stored = await readFile(path.join(project, existing));
        if (imageFormat(stored) !== "webp")
          throw Error("Bundle existente inválido.");
        outputs.push({ quantity, path: existing });
        continue;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      const data = await page.evaluate(
        async ({ encoded, count }) => {
          const image = await createImageBitmap(
            new Blob([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))]),
          );
          const sample = document.createElement("canvas");
          sample.width = image.width;
          sample.height = image.height;
          const sx = sample.getContext("2d")!;
          sx.drawImage(image, 0, 0);
          const rgba = sx.getImageData(0, 0, sample.width, sample.height).data;
          let left = image.width,
            top = image.height,
            right = 0,
            bottom = 0;
          for (let y = 0; y < image.height; y++)
            for (let x = 0; x < image.width; x++)
              if (rgba[(y * image.width + x) * 4 + 3] > 12) {
                left = Math.min(left, x);
                right = Math.max(right, x);
                top = Math.min(top, y);
                bottom = Math.max(bottom, y);
              }
          if (right <= left || bottom <= top)
            throw Error("O master não contém um produto visível.");
          const canvas = document.createElement("canvas");
          canvas.width = 1200;
          canvas.height = 1200;
          const ctx = canvas.getContext("2d")!;
          ctx.clearRect(0, 0, 1200, 1200);
          const sourceWidth = right - left + 1,
            sourceHeight = bottom - top + 1;
          type Placement = { centerX: number; y: number; height: number };
          let placements: Placement[];
          if (count === 1) {
            placements = [{ centerX: 600, y: 105, height: 990 }];
          } else if (count === 2) {
            placements = [
              { centerX: 440, y: 150, height: 900 },
              { centerX: 760, y: 150, height: 900 },
            ];
          } else if (count === 3) {
            // Compact frontal triangle: two units behind and one dominant unit in front.
            placements = [
              { centerX: 390, y: 125, height: 825 },
              { centerX: 810, y: 125, height: 825 },
              { centerX: 600, y: 235, height: 925 },
            ];
          } else if (count === 5) {
            // Tight layered pyramid instead of a spaced two-row grid.
            placements = [
              { centerX: 400, y: 70, height: 710 },
              { centerX: 800, y: 70, height: 710 },
              { centerX: 420, y: 245, height: 770 },
              { centerX: 780, y: 245, height: 770 },
              { centerX: 600, y: 345, height: 820 },
            ];
          } else {
            const backCount = Math.ceil(count / 2),
              frontCount = count - backCount,
              backSpacing = Math.min(235, 760 / Math.max(1, backCount - 1)),
              frontSpacing = Math.min(250, 650 / Math.max(1, frontCount - 1));
            placements = [];
            for (let i = 0; i < backCount; i++)
              placements.push({
                centerX: 600 + (i - (backCount - 1) / 2) * backSpacing,
                y: 95,
                height: count <= 6 ? 720 : 650,
              });
            for (let i = 0; i < frontCount; i++)
              placements.push({
                centerX: 600 + (i - (frontCount - 1) / 2) * frontSpacing,
                y: count <= 6 ? 330 : 365,
                height: count <= 6 ? 790 : 720,
              });
          }
          for (const placement of placements) {
            const scale = placement.height / sourceHeight;
            const w = sourceWidth * scale,
              h = sourceHeight * scale,
              x = placement.centerX - w / 2,
              y = placement.y;
            ctx.save();
            ctx.shadowColor = "rgba(0,0,0,.12)";
            ctx.shadowBlur = 14;
            ctx.shadowOffsetY = 8;
            ctx.drawImage(
              image,
              left,
              top,
              right - left + 1,
              bottom - top + 1,
              x,
              y,
              w,
              h,
            );
            ctx.restore();
          }
          return canvas.toDataURL("image/webp", 1).split(",")[1];
        },
        { encoded: bytes.toString("base64"), count: quantity },
      );
      const file = `brand/pack-${quantity}-r${revision}.webp`;
      await writeFile(path.join(project, file), Buffer.from(data, "base64"), {
        flag: "wx",
      });
      outputs.push({ quantity, path: file });
    }
  } finally {
    await browser.close();
  }
  return outputs;
}
