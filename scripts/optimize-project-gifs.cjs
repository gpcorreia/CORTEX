const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const limit = 5 * 1024 * 1024;
const project = path.resolve(process.argv[2] || "projects/heater-nl-nl");

const jobs = [
  ["advertorial/copy/advertorial-0cb9759a096dfa9a.gif", "advertorial/generator/advertorial-0cb9759a096dfa9a-optimized.gif"],
  ["advertorial/copy/advertorial-9cc17f5b9e94b1ce.gif", "advertorial/generator/advertorial-9cc17f5b9e94b1ce-optimized.gif"],
  ["advertorial/copy/advertorial-509c7aa9b8f6733f.gif", "advertorial/generator/advertorial-509c7aa9b8f6733f-optimized.gif"],
  ["advertorial/copy/advertorial-ef7fe4f34f82347b.gif", "advertorial/generator/advertorial-ef7fe4f34f82347b-optimized.gif"],
  ["content/copy/content-3513dcf5e27945a3.gif", "content/generator/content-3513dcf5e27945a3-optimized.gif"],
  ["content/generator/content-b19b0a558b550b12-branded-r2.gif", "content/generator/content-b19b0a558b550b12-branded-r2-optimized.gif"],
  ["content/generator/content-b8a06436e17bf80b-branded-r2.gif", "content/generator/content-b8a06436e17bf80b-branded-r2-optimized.gif"],
];

async function encode(source, target, options) {
  const bytes = await fs.readFile(source);
  const meta = await sharp(bytes, { animated: true, limitInputPixels: false }).metadata();
  const count = meta.pages ?? 1;
  const inputWidth = meta.width;
  const inputHeight = meta.pageHeight ?? meta.height;
  const scale = Math.min(1, options.width / inputWidth);
  const width = Math.max(1, Math.round(inputWidth * scale));
  const height = Math.max(1, Math.round(inputHeight * scale));
  const sourceDelays = Array.from({ length: count }, (_, index) => meta.delay?.[index] ?? 100);
  const frames = [];
  const delays = [];
  for (let index = 0; index < count; index += options.step) {
    const end = Math.min(count, index + options.step);
    delays.push(sourceDelays.slice(index, end).reduce((sum, delay) => sum + delay, 0));
    const frame = await sharp(bytes, { page: index, pages: 1, limitInputPixels: false })
      .resize(width, height, { fit: "fill", kernel: sharp.kernel.lanczos3 })
      .sharpen(0.55)
      .gif()
      .toBuffer();
    frames.push(frame);
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await sharp(frames, { join: { animated: true } })
    .gif({
      delay: delays,
      loop: meta.loop ?? 0,
      colours: options.colours,
      dither: options.dither,
      effort: 10,
      keepDuplicateFrames: true,
      interFrameMaxError: options.error,
    })
    .toFile(target);
  return { width, height, frames: frames.length, duration: delays.reduce((a, b) => a + b, 0) };
}

async function optimize(relativeSource, relativeTarget) {
  const source = path.join(project, relativeSource);
  const target = path.join(project, relativeTarget);
  const originalSize = (await fs.stat(source)).size;
  const meta = await sharp(source, { animated: true, limitInputPixels: false }).metadata();
  const averageDelay = (meta.delay ?? [100]).reduce((a, b) => a + b, 0) / (meta.pages ?? 1);
  const baseStep = averageDelay < 55 ? 2 : 1;
  const profiles = originalSize > limit
    ? [
        { width: 600, step: baseStep, colours: 160, dither: 0.5, error: 4 },
        { width: 500, step: Math.max(2, baseStep), colours: 128, dither: 0.4, error: 6 },
        { width: 500, step: Math.max(3, baseStep), colours: 112, dither: 0.35, error: 8 },
        { width: 420, step: Math.max(3, baseStep), colours: 96, dither: 0.3, error: 10 },
      ]
    : [
        { width: 800, step: baseStep, colours: 192, dither: 0.55, error: 3 },
        { width: 600, step: Math.max(2, baseStep), colours: 160, dither: 0.45, error: 5 },
      ];
  let result;
  let size = Number.POSITIVE_INFINITY;
  for (const profile of profiles) {
    result = await encode(source, target, profile);
    size = (await fs.stat(target)).size;
    if (size <= limit && size < originalSize) break;
  }
  if (size > limit)
    throw Error(`${relativeTarget} continua acima de 5 MB (${(size / 1048576).toFixed(2)} MB).`);
  console.log(JSON.stringify({
    source: relativeSource,
    output: relativeTarget,
    beforeMB: +(originalSize / 1048576).toFixed(2),
    afterMB: +(size / 1048576).toFixed(2),
    ...result,
  }));
}

(async () => {
  for (const job of jobs) await optimize(...job);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

