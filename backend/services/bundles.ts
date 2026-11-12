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
          const columns = count === 1 ? 1 : count === 2 ? 2 : Math.min(3, count),
            rows = Math.ceil(count / columns),
            gridWidth = count === 2 ? 760 : columns === 2 ? 780 : 900,
            cellW = gridWidth / columns,
            gridTop = count <= 2 ? 120 : 100,
            gridHeight = count <= 2 ? 960 : 940,
            cellH = gridHeight / rows;
          for (let i = 0; i < count; i++) {
            const row = Math.floor(i / columns),
              inRow = Math.min(columns, count - row * columns),
              col = i % columns;
            const scale = Math.min(
              (count === 2 ? 440 : cellW * 0.96) / (right - left + 1),
              (cellH * 0.82) / (bottom - top + 1),
            );
            const w = (right - left + 1) * scale,
              h = (bottom - top + 1) * scale,
              x = (1200 - inRow * cellW) / 2 + col * cellW + (cellW - w) / 2,
              y = gridTop + row * cellH + (cellH - h) / 2;
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
