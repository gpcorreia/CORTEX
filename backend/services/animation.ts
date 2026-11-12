import sharp from "sharp";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type FrameEditor = (
  source: string,
  target: string,
  index: number,
  total: number,
) => Promise<boolean>;
export interface StaticRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}
export type AnimationReviewer = (
  firstFrame: string,
  sheets: string[],
  width: number,
  height: number,
  count: number,
) => Promise<StaticRegion[]>;
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

// Decode composited full frames, not GIF sub-rectangles. Keep all work outside the product.
export async function adaptAnimation(
  source: string,
  target: string,
  workDir: string,
  edit: FrameEditor,
  review?: AnimationReviewer,
  useAllEdits = false,
) {
  const original = await readFile(source);
  const meta = await sharp(original, { animated: true }).metadata();
  const count = meta.pages ?? 1,
    width = meta.width!,
    height = meta.pageHeight ?? meta.height!;
  if (count < 2 || !["gif", "webp"].includes(meta.format!))
    throw Error("Animação GIF/WebP válida em falta.");
  if (width * height * count > 128_000_000)
    throw Error(
      "Animação demasiado grande para processamento local nesta execução.",
    );
  const delay = Array.from({ length: count }, (_, i) => meta.delay?.[i] ?? 100);
  const loop = meta.loop ?? 1;
  await mkdir(workDir, { recursive: true });
  const rawFrames: Buffer[] = [],
    frames: string[] = [];
  for (let index = 0; index < count; index++) {
    const raw = await sharp(original, { page: index, pages: 1 })
      .ensureAlpha()
      .raw()
      .toBuffer();
    rawFrames.push(raw);
    const frame = path.join(workDir, `frame-${index}.webp`);
    await writeFile(
      frame,
      await sharp(raw, { raw: { width, height, channels: 4 } })
        .webp({ lossless: true })
        .toBuffer(),
    );
    frames.push(frame);
  }
  await writeFile(
    path.join(workDir, "animation.json"),
    JSON.stringify(
      { sourceHash: hash(original), width, height, count, delay, loop, frames },
      null,
      2,
    ),
  );
  let plannedRegions: StaticRegion[] = [];
  if (review) {
    const planFile = path.join(workDir, "regions.json");
    try {
      plannedRegions = JSON.parse(await readFile(planFile, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      const sheets: string[] = [];
      for (let offset = 0; offset < frames.length; offset += 16) {
        const thumbnails = await Promise.all(
          frames.slice(offset, offset + 16).map(async (file, i) => {
            const thumbnail = await sharp(await readFile(file))
              .resize(192, 192, { fit: "contain", background: "#eeeeee" })
              .toBuffer();
            const label = Buffer.from(
              `<svg width="192" height="24"><rect width="192" height="24" fill="white"/><text x="8" y="17" font-size="14">Frame ${offset + i + 1}</text></svg>`,
            );
            return sharp(thumbnail)
              .extend({
                top: 24,
                bottom: 0,
                left: 0,
                right: 0,
                background: "white",
              })
              .composite([{ input: label, left: 0, top: 0 }])
              .webp()
              .toBuffer();
          }),
        );
        const sheet = path.join(workDir, `sheet-${offset}.webp`);
        await writeFile(
          sheet,
          await sharp(thumbnails, { join: { across: 4 } })
            .webp()
            .toBuffer(),
        );
        sheets.push(sheet);
      }
      plannedRegions = await review(frames[0], sheets, width, height, count);
    }
    if (!Array.isArray(plannedRegions))
      throw Error("Plano da animação inválido.");
    for (const region of plannedRegions) {
      if (
        ![region.left, region.top, region.width, region.height].every(
          Number.isInteger,
        ) ||
        region.left < 0 ||
        region.top < 0 ||
        region.width < 1 ||
        region.height < 1 ||
        region.left + region.width > width ||
        region.top + region.height > height
      )
        throw Error("Zona de edição fora dos limites da animação.");
      for (const frame of rawFrames.slice(1))
        for (let y = region.top; y < region.top + region.height; y++) {
          const start = (y * width + region.left) * 4;
          if (
            !frame
              .subarray(start, start + region.width * 4)
              .equals(rawFrames[0].subarray(start, start + region.width * 4))
          )
            throw Error(
              "A zona indicada move-se na animação. É necessário rever o plano antes de gerar imagens.",
            );
        }
    }
    await writeFile(planFile, JSON.stringify(plannedRegions));
  }
  const editedFrames: Buffer[] = [];
  const cache = new Map<string, Buffer>();
  let invariantMask: Uint8Array | null = null;
  let patch: Buffer | null = null;
  for (let index = 0; index < count; index++) {
    const sourceRaw = rawFrames[index];
    if (index > 0 && invariantMask && patch) {
      const pixels = Buffer.from(sourceRaw);
      applyPatch(pixels, patch, invariantMask);
      editedFrames.push(
        await sharp(pixels, { raw: { width, height, channels: 4 } })
          .webp({ lossless: true })
          .toBuffer(),
      );
      continue;
    }
    const key = hash(sourceRaw);
    let result = cache.get(key);
    if (!result) {
      const destination = path.join(workDir, `edited-${key}.webp`);
      try {
        result = await readFile(destination);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (!result) {
        if (!(await edit(frames[index], destination, index, count)))
          throw Error(
            `Frame ${index + 1}/${count} pendente; a animação original foi preservada.`,
          );
        result = await readFile(destination);
      }
      const editedMeta = await sharp(result).metadata();
      if (
        editedMeta.format !== "webp" ||
        editedMeta.width !== width ||
        editedMeta.height !== height ||
        (editedMeta.pages ?? 1) !== 1
      )
        throw Error(`O frame ${index + 1} tem dimensões ou formato inválidos.`);
      cache.set(key, result);
    }
    editedFrames.push(result);
    if (index === 0 && !useAllEdits) {
      const editedRaw = await sharp(result).ensureAlpha().raw().toBuffer();
      const mask = new Uint8Array(width * height);
      let changed = 0,
        invariant = true;
      for (let p = 0; p < mask.length; p++) {
        const x = p % width,
          y = Math.floor(p / width);
        const region = plannedRegions.find(
          (r) =>
            x >= r.left &&
            x < r.left + r.width &&
            y >= r.top &&
            y < r.top + r.height,
        );
        if (plannedRegions.length && !region) continue;
        if (
          !sourceRaw
            .subarray(p * 4, p * 4 + 4)
            .equals(editedRaw.subarray(p * 4, p * 4 + 4))
        ) {
          mask[p] = region
            ? Math.round(
                255 *
                  Math.min(
                    1,
                    (Math.min(
                      x - region.left,
                      y - region.top,
                      region.left + region.width - 1 - x,
                      region.top + region.height - 1 - y,
                    ) +
                      1) /
                      3,
                  ),
              )
            : 255;
          changed++;
        }
      }
      if (!changed)
        throw Error(
          "O frame editado não contém alterações; animação não marcada como concluída.",
        );
      // Reuse ONE edit only when every changed pixel is constant throughout the complete source animation.
      for (const frame of rawFrames.slice(1)) {
        for (let p = 0; p < mask.length; p++)
          if (
            mask[p] &&
            !frame
              .subarray(p * 4, p * 4 + 4)
              .equals(sourceRaw.subarray(p * 4, p * 4 + 4))
          ) {
            invariant = false;
            break;
          }
        if (!invariant) break;
      }
      if (invariant) {
        invariantMask = mask;
        patch = editedRaw;
        if (plannedRegions.length) {
          const pixels = Buffer.from(sourceRaw);
          applyPatch(pixels, patch, mask);
          editedFrames[0] = await sharp(pixels, {
            raw: { width, height, channels: 4 },
          })
            .webp({ lossless: true })
            .toBuffer();
        }
      }
    }
  }
  if (
    new Set(rawFrames.map(hash)).size > 1 &&
    new Set(editedFrames.map(hash)).size < 2
  )
    throw Error("A edição removeu o movimento da animação.");
  const output =
    meta.format === "gif"
      ? await sharp(editedFrames, { join: { animated: true } })
          .gif({
            delay,
            loop,
            keepDuplicateFrames: true,
            interFrameMaxError: 0,
            interPaletteMaxError: 0,
          })
          .toBuffer()
      : await muxWebp(editedFrames, width, height, delay, loop);
  const final = await sharp(output, { animated: true }).metadata();
  if (
    final.width !== width ||
    final.pageHeight !== height ||
    final.pages !== count ||
    JSON.stringify(final.delay) !== JSON.stringify(delay) ||
    (final.loop ?? 1) !== loop
  )
    throw Error(
      "A montagem não preservou frames, dimensões, tempos ou repetição.",
    );
  await writeFile(target, output, { flag: "wx" });
}

function applyPatch(pixels: Buffer, patch: Buffer, mask: Uint8Array) {
  for (let p = 0; p < mask.length; p++)
    if (mask[p])
      for (let channel = 0; channel < 4; channel++) {
        const index = p * 4 + channel;
        pixels[index] = Math.round(
          pixels[index] * (1 - mask[p] / 255) + (patch[index] * mask[p]) / 255,
        );
      }
}

function chunk(type: string, bytes: Buffer) {
  const header = Buffer.alloc(8);
  header.write(type);
  header.writeUInt32LE(bytes.length, 4);
  return Buffer.concat([
    header,
    bytes,
    ...(bytes.length % 2 ? [Buffer.alloc(1)] : []),
  ]);
}
// Explicit ANMF mux keeps duplicate WebP frames and exact per-frame delays.
async function muxWebp(
  frames: Buffer[],
  width: number,
  height: number,
  delay: number[],
  loop: number,
) {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x12;
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const anim = Buffer.alloc(6);
  anim.writeUInt16LE(loop, 4);
  const chunks = [chunk("VP8X", vp8x), chunk("ANIM", anim)];
  for (let i = 0; i < frames.length; i++) {
    const encoded = await sharp(frames[i]).webp({ lossless: true }).toBuffer();
    const imageChunks: Buffer[] = [];
    for (let offset = 12; offset + 8 <= encoded.length;) {
      const size = encoded.readUInt32LE(offset + 4),
        end = offset + 8 + size + (size % 2);
      if (
        ["VP8L", "VP8 ", "ALPH"].includes(
          encoded.toString("ascii", offset, offset + 4),
        )
      )
        imageChunks.push(encoded.subarray(offset, end));
      offset = end;
    }
    const header = Buffer.alloc(16);
    header.writeUIntLE(width - 1, 6, 3);
    header.writeUIntLE(height - 1, 9, 3);
    header.writeUIntLE(delay[i], 12, 3);
    header[15] = 2;
    chunks.push(chunk("ANMF", Buffer.concat([header, ...imageChunks])));
  }
  const body = Buffer.concat([Buffer.from("WEBP"), ...chunks]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}
