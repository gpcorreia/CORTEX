import type { Page } from "playwright";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseHTML } from "linkedom";

export interface TextBlock {
  id: string;
  source: string;
  kind: "html" | "attribute";
  attribute?: string;
  section: string;
  role?: "headline" | "usp";
}
export interface PageCapture {
  url: string;
  requestedUrl?: string;
  title: string;
  language: string;
  html: string;
  css: string;
  blocks: TextBlock[];
  media: { id: string; url: string; kind: "image" | "background" }[];
  limitations: string[];
}
export interface CapturedPage {
  competitor: number;
  page: "advertorial" | "content";
  directory: string;
  capture: PageCapture;
}

// Runs in the already-open competitor browser, with no additional navigation/download.
function inspectDocument() {
  const properties = [
    "display",
    "position",
    "top",
    "right",
    "bottom",
    "left",
    "z-index",
    "box-sizing",
    "width",
    "height",
    "min-width",
    "max-width",
    "min-height",
    "max-height",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "line-height",
    "letter-spacing",
    "text-align",
    "text-transform",
    "text-decoration",
    "color",
    "background-color",
    "border-top",
    "border-right",
    "border-bottom",
    "border-left",
    "border-radius",
    "box-shadow",
    "opacity",
    "overflow",
    "object-fit",
    "object-position",
    "flex-direction",
    "flex-wrap",
    "flex-grow",
    "flex-shrink",
    "flex-basis",
    "justify-content",
    "align-items",
    "gap",
    "grid-template-columns",
    "grid-template-rows",
    "vertical-align",
    "white-space",
  ];
  const root = document.body;
  properties.push(
    "background-size",
    "background-position",
    "background-repeat",
  );
  let next = Number(root.dataset.funnelCounter ?? 0);
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  const rules: string[] = [];
  const backgrounds: { node: string; url: string }[] = [];
  for (const element of all) {
    if (
      element.closest(
        "script,style,template,noscript,iframe,svg,canvas,video,audio",
      )
    )
      continue;
    const node = element as HTMLElement;
    node.dataset.funnelNode ||= "n" + ++next;
    const style = getComputedStyle(node);
    const bounds = node.getBoundingClientRect(),
      bg = /^url\(["']?(.*?)["']?\)$/.exec(style.backgroundImage);
    if (bg && bounds.width >= 240 && bounds.height >= 140)
      backgrounds.push({ node: node.dataset.funnelNode, url: bg[1] });
    if (node.tagName === "IMG")
      node.dataset.funnelImageSource =
        node.getAttribute("data-original") ||
        node.getAttribute("data-src") ||
        (node as HTMLImageElement).currentSrc ||
        node.getAttribute("src") ||
        "";
    const typed = (
      node as HTMLElement & {
        computedStyleMap?: () => Map<string, { toString(): string }>;
      }
    ).computedStyleMap?.();
    rules.push(
      `[data-funnel-node="${node.dataset.funnelNode}"]{${properties
        .map((p) => {
          const value =
            /^(?:width|height|min-|max-|grid-template|flex-basis|gap)/.test(p)
              ? typed?.get(p)?.toString() || style.getPropertyValue(p)
              : style.getPropertyValue(p);
          return `${p}:${value.replace(/</g, "\\3c ")}`;
        })
        .join(";")}}`,
    );
  }
  root.dataset.funnelCounter = String(next);
  return {
    html: root.outerHTML,
    css: rules.join("\n"),
    url: location.href,
    title: document.title,
    language: document.documentElement.lang,
    backgrounds,
  };
}

export async function captureViewport(page: Page) {
  return page.evaluate<ReturnType<typeof inspectDocument>>(
    `((${inspectDocument.toString()})())`,
  );
}

const inline = new Set([
  "A",
  "STRONG",
  "B",
  "EM",
  "I",
  "SPAN",
  "U",
  "S",
  "SMALL",
  "SUP",
  "SUB",
  "BR",
]);
export function sanitizeCapture(
  desktop: Awaited<ReturnType<typeof captureViewport>>,
  mobile?: Awaited<ReturnType<typeof captureViewport>>,
): PageCapture {
  const { document } = parseHTML(
    `<!doctype html><html><head></head>${desktop.html}</html>`,
  );
  const media: PageCapture["media"] = [],
    blocks: TextBlock[] = [];
  const limitations = [
    "Scripts, integrações e fontes externas não foram arquivados. Interações dinâmicas devem ser revistas na versão local.",
  ];
  const sourceUrl = (value: string) => {
    try {
      const u = new URL(value, desktop.url);
      return /^https?:$/.test(u.protocol) ? u.href : "";
    } catch {
      return "";
    }
  };
  document
    .querySelectorAll(
      "script,style,link,meta,base,template,noscript,iframe,object,embed,canvas,video,audio,source",
    )
    .forEach((n) => n.remove());
  document
    .querySelectorAll(
      'input[type="hidden"], [id*="onetrust" i], [id*="cookiebot" i], [class*="cookie-banner" i], [class*="cookie-consent" i], [class*="consent-banner" i], [class*="newsletter-popup" i]',
    )
    .forEach((n) => n.remove());
  for (const element of Array.from(document.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        [
          "style",
          "srcset",
          "srcdoc",
          "action",
          "formaction",
          "ping",
          "autofocus",
          "crossorigin",
          "integrity",
          "nonce",
        ].includes(name)
      )
        element.removeAttribute(attribute.name);
      else if (
        ["href", "src", "poster", "xlink:href"].includes(name) &&
        !["A", "IMG"].includes(element.tagName)
      )
        element.removeAttribute(attribute.name);
    }
    if (element.tagName === "A") {
      element.setAttribute(
        "data-source-href",
        sourceUrl(element.getAttribute("href") ?? ""),
      );
      element.setAttribute("href", "#");
      element.removeAttribute("target");
    }
    if (element.tagName === "BUTTON") element.setAttribute("type", "button");
    if (element.tagName === "IMG") {
      const url = sourceUrl(
        element.getAttribute("data-funnel-image-source") ||
          element.getAttribute("data-original") ||
          element.getAttribute("data-src") ||
          element.getAttribute("src") ||
          "",
      );
      const id = "m" + (media.length + 1);
      media.push({ id, url, kind: "image" });
      element.setAttribute("data-funnel-media", id);
      element.setAttribute("src", placeholder);
      element.removeAttribute("loading");
    }
  }
  for (const bg of desktop.backgrounds ?? []) {
    const element = document.querySelector(`[data-funnel-node="${bg.node}"]`);
    if (!element) continue;
    const id = "m" + (media.length + 1);
    media.push({ id, url: sourceUrl(bg.url), kind: "background" });
    element.setAttribute("data-funnel-background", id);
  }
  // Preserve inline emphasis and links, while excluding attributes/code from the model input.
  const cleanFragment = (element: Element) => {
    const clone = element.cloneNode(true) as Element;
    for (const n of Array.from(clone.querySelectorAll("*")))
      for (const a of Array.from(n.attributes)) n.removeAttribute(a.name);
    return clone.innerHTML;
  };
  const candidates =
    "h1,h2,h3,h4,h5,h6,p,li,blockquote,button,summary,label,figcaption,dt,dd";
  const add = (
    element: Element,
    source: string,
    kind: TextBlock["kind"],
    attribute?: string,
  ) => {
    if ((!element.textContent?.trim() && kind === "html") || !source.trim())
      return;
    const id = "b" + (blocks.length + 1);
    element.setAttribute(
      attribute ? "data-funnel-" + attribute : "data-funnel-block",
      id,
    );
    blocks.push({
      id,
      source,
      kind,
      ...(attribute ? { attribute } : {}),
      section:
        element
          .closest("section,article,main")
          ?.getAttribute("data-funnel-node") ?? "body",
    });
  };
  for (const element of Array.from(document.querySelectorAll(candidates))) {
    if (
      element.querySelector(candidates) ||
      Array.from(element.querySelectorAll("*")).some(
        (n) => !inline.has(n.tagName),
      )
    )
      continue;
    add(element, cleanFragment(element), "html");
  }
  const visit = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3 && child.textContent?.trim()) {
        const parent = child.parentElement;
        if (
          !parent ||
          parent.closest("[data-funnel-block],svg,textarea,option")
        )
          continue;
        const span = document.createElement("span");
        child.replaceWith(span);
        span.textContent = child.textContent;
        add(span, span.innerHTML, "html");
      } else if (child.nodeType === 1) visit(child);
    }
  };
  visit(document.body);
  for (const element of Array.from(
    document.querySelectorAll("[placeholder],img[alt]"),
  ))
    for (const attr of ["placeholder", "alt"]) {
      const value = element.getAttribute(attr);
      if (value) add(element, value, "attribute", attr);
    }
  for (const element of Array.from(document.querySelectorAll("*")))
    for (const attr of Array.from(element.attributes))
      if (
        attr.name.startsWith("data-") &&
        !attr.name.startsWith("data-funnel-") &&
        attr.name !== "data-source-href"
      )
        element.removeAttribute(attr.name);
  // Styles are captured as computed declarations: no original CSS imports/URLs/scripts are retained.
  const cleanCss = (css: string) =>
    css.replace(/url\([^)]*\)/gi, "none").replace(/<\/style/gi, "\\3c /style");
  if (mobile && mobile.html !== desktop.html)
    limitations.push(
      "A disposição mobile usa os estilos capturados a 390 px; confirmar quebras de linha e elementos inseridos dinamicamente.",
    );
  return {
    url: desktop.url,
    title: desktop.title,
    language: desktop.language,
    html: document.body.outerHTML,
    css: `html,body{margin:0}img{max-width:100%}\n${cleanCss(desktop.css)}\n${mobile ? `@media(max-width:767px){${cleanCss(mobile.css)}}` : ""}`,
    blocks,
    media,
    limitations,
  };
}

/** Adds semantic layout hints without changing the captured source HTML. */
export function classifyTextBlocks(capture: PageCapture): PageCapture {
  const { document } = parseHTML(
    `<!doctype html><html><body>${capture.html}</body></html>`,
  );
  const blocks = capture.blocks.map((block) => ({ ...block }));
  const bySection = new Map<string, TextBlock[]>();
  for (const block of blocks) {
    const group = bySection.get(block.section) ?? [];
    group.push(block);
    bySection.set(block.section, group);
    const element = document.querySelector(
      `[${block.kind === "html" ? "data-funnel-block" : "data-funnel-" + block.attribute}="${block.id}"]`,
    );
    if (
      element &&
      (/^H[1-6]$/.test(element.tagName) ||
        element.closest(".headline,.headline-inner"))
    )
      block.role = "headline";
  }
  for (const group of bySection.values()) {
    for (const [index, block] of group.entries()) {
      if (block.role !== "headline") continue;
      const following = group.slice(index + 1, index + 6);
      if (
        following.length === 5 &&
        following.every(
          (item) =>
            item.kind === "html" &&
            !item.role &&
            item.source.replace(/<[^>]*>/g, "").trim().length <= 120,
        )
      )
        for (const item of following) item.role = "usp";
    }
  }
  return { ...capture, blocks };
}
export const placeholder =
  "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

export async function savePageCapture(
  project: string,
  competitor: number,
  page: CapturedPage["page"],
  capture: PageCapture,
) {
  const dir = path.join(
    project,
    "funil/copy",
    `competitor-${competitor}`,
    page,
  );
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "page.html"), capture.html);
  await writeFile(path.join(dir, "styles.css"), capture.css);
  await writeFile(
    path.join(dir, "page.json"),
    JSON.stringify(capture, null, 2),
  );
}
export async function readPageCaptures(
  project: string,
): Promise<CapturedPage[]> {
  const root = path.join(project, "funil/copy"),
    result: CapturedPage[] = [];
  for (const name of await readdir(root).catch(() => [])) {
    if (!/^competitor-[1-3]$/.test(name)) continue;
    for (const page of ["advertorial", "content"] as const) {
      try {
        result.push({
          competitor: Number(name.slice(-1)),
          page,
          directory: path.join(root, name, page),
          capture: JSON.parse(
            await readFile(path.join(root, name, page, "page.json"), "utf8"),
          ),
        });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
  }
  return result.sort(
    (a, b) => a.competitor - b.competitor || a.page.localeCompare(b.page),
  );
}
