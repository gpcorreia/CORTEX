import { parseHTML } from "linkedom";
import { createHash } from "node:crypto";
import path from "node:path";
import type { PageCapture, TextBlock } from "./funnelCapture.js";

export function applyBlock(
  document: Document,
  block: TextBlock,
  translated: string,
) {
  const element = document.querySelector(
    `[${block.kind === "html" ? "data-funnel-block" : "data-funnel-" + block.attribute}="${block.id}"]`,
  );
  if (!element) throw Error("Bloco de texto em falta: " + block.id);
  if (block.kind === "attribute") {
    element.setAttribute(block.attribute!, translated);
    return;
  }
  const fragment = parseHTML(
    `<html><body><div id="fragment">${translated}</div></body></html>`,
  ).document.querySelector("#fragment")!;
  const source = Array.from(element.querySelectorAll("*")),
    target = Array.from(fragment.querySelectorAll("*"));
  if (
    source.length !== target.length ||
    source.some(
      (n, i) =>
        n.tagName !== target[i].tagName ||
        n.parentElement?.tagName !==
          (target[i].parentElement === fragment
            ? element.tagName
            : target[i].parentElement?.tagName),
    )
  )
    throw Error(
      "A tradução alterou a estrutura ou a ênfase do bloco " + block.id,
    );
  for (const [i, node] of target.entries()) {
    if (node.attributes.length)
      throw Error("A tradução introduziu atributos HTML.");
    for (const attr of Array.from(source[i].attributes))
      node.setAttribute(attr.name, attr.value);
  }
  element.replaceChildren(...Array.from(fragment.childNodes));
}

export function validateBlock(block: TextBlock, translated: string) {
  if (block.kind === "attribute") {
    if (/<[^>]+>/.test(translated))
      throw Error("HTML inesperado num atributo.");
    return;
  }
  const { document } = parseHTML(
    `<html><body><div data-funnel-block="${block.id}">${block.source}</div></body></html>`,
  );
  applyBlock(document, block, translated);
}
export function renderPreview(
  capture: PageCapture,
  translations: Record<string, string>,
  locale: string,
  media: Record<string, string>,
) {
  const { document } = parseHTML(
    `<!doctype html><html><head></head>${capture.html}</html>`,
  );
  for (const block of capture.blocks) {
    if (translations[block.id] === undefined)
      throw Error("Tradução em falta: " + block.id);
    applyBlock(document, block, translations[block.id]);
    if (block.role) {
      const element = document.querySelector(
        `[${block.kind === "html" ? "data-funnel-block" : "data-funnel-" + block.attribute}="${block.id}"]`,
      );
      element?.setAttribute("data-funnel-role", block.role);
    }
  }
  for (const item of capture.media) {
    const element = document.querySelector(
      `[${item.kind === "background" ? "data-funnel-background" : "data-funnel-media"}="${item.id}"]`,
    );
    if (element && media[item.id]) {
      if (item.kind === "background")
        element.setAttribute(
          "style",
          `background-image:url("${media[item.id]}")`,
        );
      else element.setAttribute("src", media[item.id]);
    }
  }
  document.documentElement.lang = locale;
  const charset = document.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  document.head.appendChild(charset);
  const title = document.createElement("title");
  title.textContent =
    document.querySelector("h1")?.textContent ?? capture.title;
  document.head.appendChild(title);
  const style = document.createElement("style");
  style.textContent = `${capture.css}
@media(max-width:767px){
  [data-funnel-role="usp"]{white-space:nowrap}
}`;
  document.head.appendChild(style);
  return "<!doctype html>\n" + document.documentElement.outerHTML;
}
export const assetKey = (file: string) =>
  createHash("sha256").update(file).digest("hex").slice(0, 24);
export function localProjectFile(project: string, relative: string) {
  const file = path.resolve(project, relative);
  if (!file.startsWith(path.resolve(project) + path.sep))
    throw Error("Ficheiro fora do projeto.");
  return file;
}
