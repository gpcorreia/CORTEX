import { chromium } from "playwright";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  captureViewport,
  sanitizeCapture,
  type PageCapture,
} from "./funnelCapture.js";

export type MediaRole = "product" | "section" | "review";
export interface Candidate {
  url: string;
  role: MediaRole;
  width: number;
  height: number;
}
export interface PageMedia {
  capture?: PageCapture;
  captureError?: string;
  title: string;
  heading: string;
  assets: Candidate[];
}
export interface DownloadedMedia {
  downloadedOriginal?: string;
  downloadedHash?: string;
  animated?: boolean;
  frameCount?: number | null;
  competitor?: number;
  sources?: { competitor: number; url: string }[];
  id: string;
  page: "advertorial" | "content";
  role: MediaRole;
  sourceUrl: string;
  original: string;
  optimized?: string;
  width: number;
  height: number;
  format: string;
  hash: string;
  selected: boolean;
  action: "keep" | "translate" | "replace" | "both";
  output: string | null;
  status: "downloaded" | "excluded" | "completed" | "pending";
}
export function parseImageSrcset(
  value: string,
): { url: string; size: number }[] {
  const entries: { url: string; size: number }[] = [];
  const matcher = /(?:^|,\s*)(\S+)\s+(\d+(?:\.\d+)?)(?:w|x)(?=\s*(?:,|$))/g;
  for (const match of value.matchAll(matcher))
    entries.push({ url: match[1], size: Number(match[2]) });
  // A single URL may legally contain commas in optimization parameters.
  if (!entries.length && value.trim())
    entries.push({ url: value.trim(), size: 0 });
  return entries.sort((a, b) => b.size - a.size);
}
export function originalImageUrl(source: string, base: string) {
  const url = new URL(source, base);
  if (!["http:", "https:"].includes(url.protocol)) return "";
  if (
    url.hostname === "img.funnelish.com" &&
    /\.(?:gif|webp|png|jpe?g|avif)$/i.test(url.pathname)
  )
    url.search = "";
  return url.href;
}
export function animationInfo(bytes: Buffer, format: string) {
  if (format === "webp") {
    let frames = 0;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const type = bytes.toString("ascii", offset, offset + 4),
        size = bytes.readUInt32LE(offset + 4);
      if (type === "ANMF") frames++;
      offset += 8 + size + (size % 2);
    }
    return {
      animated: frames > 1 || bytes.includes(Buffer.from("ANIM")),
      frameCount: frames || 1,
    };
  }
  if (format === "gif") {
    let offset = 13,
      frames = 0;
    if (bytes.length < 13) return { animated: false, frameCount: 0 };
    if (bytes[10] & 128) offset += 3 * (1 << ((bytes[10] & 7) + 1));
    while (offset < bytes.length) {
      const type = bytes[offset++];
      if (type === 0x3b) break;
      if (type === 0x21) offset++;
      else if (type === 0x2c) {
        if (offset + 9 > bytes.length) break;
        frames++;
        const packed = bytes[offset + 8];
        offset += 9;
        if (packed & 128) offset += 3 * (1 << ((packed & 7) + 1));
        offset++;
      } else break;
      while (offset < bytes.length) {
        const length = bytes[offset++];
        if (!length) break;
        offset += length;
      }
    }
    return { animated: frames > 1, frameCount: frames };
  }
  return { animated: false, frameCount: 1 };
}
async function saveWithoutOverwrite(
  directory: string,
  basename: string,
  bytes: Buffer,
) {
  for (let n = 1; n < 10000; n++) {
    const extension = path.extname(basename),
      name =
        n === 1
          ? basename
          : `${basename.slice(0, -extension.length)} (${n})${extension}`;
    try {
      await writeFile(path.join(directory, name), bytes, { flag: "wx" });
      return name;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const previous = await readFile(path.join(directory, name));
      if (previous.equals(bytes)) return name;
    }
  }
  throw new Error("Não foi possível reservar um nome de ficheiro livre.");
}

export function imageFormat(bytes: Buffer): string | null {
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  if (["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6)))
    return "gif";
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpg";
  if (
    bytes.toString("ascii", 4, 8) === "ftyp" &&
    /avif|avis/.test(bytes.toString("ascii", 8, 32))
  )
    return "avif";
  return null;
}
export function imageAllowed(candidate: Candidate) {
  return (
    candidate.width >= 120 &&
    candidate.height >= 100 &&
    !/\.(?:svg|json|js|css|mp4|webm|mov|lottie)(?:[?#]|$)/i.test(candidate.url)
  );
}
export async function discoverMedia(url: string): Promise<PageMedia> {
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    await page.route("**/*", (r) => {
      const type = r.request().resourceType();
      return ["media", "font"].includes(type) ||
        /google-analytics|googletagmanager|connect\.facebook\.net/.test(
          r.request().url(),
        )
        ? r.abort()
        : r.continue();
    });
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    if (response && !response.ok()) throw Error(`HTTP ${response.status()} ao abrir a página.`);
    const snapshot = () => {
      const assets: {
        url: string;
        role: "product" | "section" | "review";
        width: number;
        height: number;
      }[] = [];
      const ignored =
        /favicon|emoji|payment[-_ ]?icon|flag[-_ ]|trustbadge|loader|spinner|avatar|logo/i;
      function append(
        node: Element,
        source: string,
        width: number,
        height: number,
      ) {
        if (
          !source ||
          node.closest("header,footer,nav") ||
          width < 120 ||
          height < 100
        )
          return;
        if (ignored.test(source + " " + (node.getAttribute("alt") ?? "")))
          return;
        let url: URL;
        try {
          url = new URL(source, location.href);
        } catch {
          return;
        }
        if (!["http:", "https:"].includes(url.protocol)) return;
        const normalized = originalImageUrl(url.href, location.href);
        if (!normalized) return;
        const context =
          (node
            .closest(
              '[class*="review" i],[class*="testimonial" i],[class*="gallery" i],[class*="product" i],[class*="slider" i],[class*="carousel" i],section',
            )
            ?.getAttribute("class") ?? "") +
          " " +
          (node.getAttribute("alt") ?? "");
        const role = /review|testimonial|before.?after/i.test(context)
          ? "review"
          : /product|gallery|carousel|slider/i.test(context)
            ? "product"
            : "section";
        assets.push({ url: normalized, role, width, height });
      }
      for (const image of document.images) {
        const bounds = image.getBoundingClientRect();
        // Natural dimensions alone include hidden template leftovers and large icon source files.
        // Use the rendered section image; responsive alternatives resolve through srcset below.
        const gallery = image.closest(
          '[class*="image-slider" i],[class*="gallery" i],[class*="product-images" i],[class*="product-gallery" i],[class*="carousel" i],[class*="swiper" i]',
        );
        if (
          !gallery &&
          (bounds.width < 120 ||
            bounds.height < 100 ||
            image.closest('[hidden],[aria-hidden="true"]'))
        )
          continue;
        const sources = [
          image.getAttribute("data-original"),
          image.getAttribute("data-original-src"),
          image.getAttribute("data-src"),
          image.getAttribute("data-lazy-src"),
          image.getAttribute("src"),
          image.currentSrc,
        ];
        const sets = [
          image.getAttribute("data-srcset"),
          image.srcset,
          ...Array.from(
            image.closest("picture")?.querySelectorAll("source") ?? [],
          )
            .filter((s) => !s.media || matchMedia(s.media).matches)
            .map(
              (s) => s.getAttribute("data-srcset") || s.getAttribute("srcset"),
            ),
        ];
        const variants = sets
          .filter(Boolean)
          .flatMap((s) => parseImageSrcset(s!).map((entry) => entry.url));
        const candidates = [...sources, ...variants].filter(
          (s): s is string =>
            Boolean(s) && !s!.startsWith("data:") && !s!.startsWith("blob:"),
        );
        const gif = candidates.find((s) => /\.gif(?:[?#]|$)/i.test(s));
        const source = gif || variants[0] || candidates[0];
        if (source)
          append(
            image,
            source,
            gallery ? Math.max(120, bounds.width) : bounds.width,
            gallery ? Math.max(100, bounds.height) : bounds.height,
          );
      }
      // Large section backgrounds can be product/review media too; CSS files themselves are never saved.
      for (const node of document.querySelectorAll(
        'section,main div,[style*="background"]',
      )) {
        const bounds = node.getBoundingClientRect();
        if (bounds.width < 240 || bounds.height < 140) continue;
        const bg = getComputedStyle(node).backgroundImage;
        const match = /^url\(["']?(.*?)["']?\)$/.exec(bg);
        if (match) append(node, match[1], bounds.width, bounds.height);
      }
      return {
        title: document.title.slice(0, 200),
        heading: (document.querySelector("h1")?.textContent ?? "")
          .trim()
          .slice(0, 200),
        assets,
      };
    };
    // tsx preserves function names with __name; provide that helper locally in the browser evaluation.
    const script = `((__name,parseImageSrcset,originalImageUrl) => (${snapshot.toString()})())((fn) => fn,${parseImageSrcset.toString()},${originalImageUrl.toString()})`;
    const collected = new Map<string, Candidate>();
    let title = "",
      heading = "";
    let desktopCapture: Awaited<ReturnType<typeof captureViewport>> | undefined;
    let mobileCapture: Awaited<ReturnType<typeof captureViewport>> | undefined;
    let captureError = "";
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo(0, 0));
      for (let step = 0; step < 60; step++) {
        const end = await page.evaluate(() => {
          window.scrollBy(0, 700);
          return scrollY + innerHeight >= document.documentElement.scrollHeight;
        });
        await page.waitForTimeout(200);
        if (step % 3 === 0 || end) {
          const result = (await page.evaluate(script)) as PageMedia;
          title = result.title;
          heading = result.heading;
          for (const asset of result.assets) collected.set(asset.url, asset);
        }
        if (end) {
          await page.waitForTimeout(500);
          const result = (await page.evaluate(script)) as PageMedia;
          for (const asset of result.assets) collected.set(asset.url, asset);
          break;
        }
      }
      try {
        const captured = await captureViewport(page);
        if (viewport.width === 1440) desktopCapture = captured;
        else mobileCapture = captured;
      } catch (e) {
        captureError = (e as Error).message;
      }
    }
    let capture: PageCapture | undefined;
    try {
      if (desktopCapture)
        capture = sanitizeCapture(desktopCapture, mobileCapture);
    } catch (e) {
      captureError = (e as Error).message;
    }
    if (capture && captureError) capture.limitations.push(captureError);
    return {
      title,
      heading,
      assets: [...collected.values()],
      ...(capture ? { capture } : {}),
      ...(captureError ? { captureError } : {}),
    };
  } finally {
    await browser.close();
  }
}
export async function downloadMedia(
  project: string,
  page: "advertorial" | "content",
  candidates: Candidate[],
  onProgress: (text: string) => void,
  fetcher: typeof fetch = fetch,
) {
  const assets: DownloadedMedia[] = [];
  const failures: string[] = [];
  const urls = new Set<string>(),
    hashes = new Set<string>();
  await mkdir(path.join(project, page, "copy"), { recursive: true });
  for (const candidate of candidates) {
    if (!imageAllowed(candidate) || urls.has(candidate.url)) continue;
    urls.add(candidate.url);
    try {
      const response = await fetcher(candidate.url, {
        signal: AbortSignal.timeout(20000),
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const mime = response.headers.get("content-type") ?? "";
      if (
        mime &&
        !mime.startsWith("image/") &&
        !mime.startsWith("application/octet-stream") &&
        !mime.startsWith("binary/octet-stream")
      )
        throw new Error("Não é uma imagem.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (!response.body) throw new Error("Resposta vazia.");
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > 20 * 1024 * 1024)
          throw new Error("Imagem superior a 20 MB.");
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const format = imageFormat(bytes);
      if (!format) throw new Error("Formato não suportado.");
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (hashes.has(hash)) continue;
      hashes.add(hash);
      const id = `${page}-${hash.slice(0, 16)}`;
      const name = await saveWithoutOverwrite(
        path.join(project, page, "copy"),
        `${id}.${format}`,
        bytes,
      );
      const original = `${page}/copy/${name}`;
      assets.push({
        id,
        page,
        role: candidate.role,
        sourceUrl: candidate.url,
        original,
        width: candidate.width,
        height: candidate.height,
        format,
        hash,
        ...animationInfo(bytes, format),
        selected: true,
        action: "keep",
        output: null,
        status: "downloaded",
      });
      onProgress(
        `${assets.length} imagens guardadas · ${page === "content" ? "Sales Page" : "Advertorial"}`,
      );
    } catch (e) {
      failures.push(`${candidate.url}: ${(e as Error).message}`);
    }
  }
  return { assets, failures };
}
