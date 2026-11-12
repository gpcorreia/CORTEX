import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
export interface CompetitorInput {
  advertorialUrl: string;
  salesPageUrl: string;
}
export interface Inputs {
  competitors: CompetitorInput[];
  createBrand: boolean;
  sameProduct?: boolean;
  productImage: string | null;
  locale: string;
  currency: string;
}
export function validateInputs(value: unknown): Inputs {
  const v = value as Record<string, unknown>;
  if (!v || typeof v !== "object") throw new Error("Inputs inválidos.");
  const link = (value: unknown) => {
    if (typeof value !== "string")
      throw new Error("Preenche os dois links de cada concorrente.");
    let u: URL;
    try {
      u = new URL(value);
    } catch {
      throw new Error("Um dos links não é válido.");
    }
    if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
      throw new Error("Usa links HTTP ou HTTPS sem credenciais.");
    return u.href;
  };
  // Older saved inputs had a single pair at the top level.
  const raw =
    v.competitors === undefined
      ? [{ advertorialUrl: v.advertorialUrl, salesPageUrl: v.salesPageUrl }]
      : v.competitors;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 3)
    throw new Error("Adiciona entre um e três concorrentes.");
  const competitors = raw.map((item) => {
    if (!item || typeof item !== "object")
      throw new Error("Concorrente inválido.");
    return {
      advertorialUrl: link(item.advertorialUrl),
      salesPageUrl: link(item.salesPageUrl),
    };
  });
  if (typeof v.createBrand !== "boolean")
    throw new Error("Escolhe a opção de branding.");
  if (
    typeof v.locale !== "string" ||
    ![
      "nl-NL",
      "nl-BE",
      "en-GB",
      "en-US",
      "en-CA",
      "en-AU",
      "de-DE",
      "de-AT",
      "de-CH",
      "fr-FR",
      "fr-BE",
      "fr-CA",
      "es-ES",
      "it-IT",
      "pt-PT",
      "pt-BR",
      "sv-SE",
      "da-DK",
      "nb-NO",
      "fi-FI",
      "pl-PL",
    ].includes(v.locale)
  )
    throw new Error("Escolhe um idioma e mercado válidos.");
  if (
    typeof v.currency !== "string" ||
    ![
      "EUR",
      "GBP",
      "USD",
      "CAD",
      "AUD",
      "CHF",
      "SEK",
      "DKK",
      "NOK",
      "PLN",
      "BRL",
    ].includes(v.currency)
  )
    throw new Error("Escolhe uma moeda válida.");
  let productImage: string | null = null;
  if (v.productImage !== null && v.productImage !== undefined) {
    if (typeof v.productImage !== "string" || v.productImage.length > 7_000_000)
      throw new Error("Imagem demasiado grande.");
    const m =
      /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
        v.productImage,
      );
    if (!m) throw new Error("Usa PNG, JPEG ou WebP.");
    const b = Buffer.from(m[2], "base64");
    const valid =
      m[1] === "png"
        ? b
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : m[1] === "jpeg"
          ? b[0] === 255 && b[1] === 216 && b[2] === 255
          : b.toString("ascii", 0, 4) === "RIFF" &&
            b.toString("ascii", 8, 12) === "WEBP";
    if (!valid || b.length > 5 * 1024 * 1024)
      throw new Error("Imagem inválida ou superior a 5 MB.");
    productImage = v.productImage;
  }
  if (v.sameProduct !== undefined && typeof v.sameProduct !== "boolean")
    throw new Error("Escolhe se o produto é igual ao do concorrente.");
  if (v.createBrand && !productImage && v.sameProduct !== true)
    throw new Error("Com branding, a fotografia do produto é obrigatória.");
  return {
    competitors,
    createBrand: v.createBrand,
    ...(v.createBrand && v.sameProduct === true ? { sameProduct: true } : {}),
    productImage,
    locale: v.locale,
    currency: v.currency,
  };
}
export async function saveInputs(
  dir: string,
  id: string,
  inputs: Inputs,
  productName?: string,
) {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, id + ".json"),
    temp = file + "." + randomUUID() + ".tmp";
  const record = {
    productId: id,
    stage: 1,
    status: "inputs_saved",
    savedAt: new Date().toISOString(),
    inputs,
    ...(productName ? { productName } : {}),
  };

  console.log(
    `Inputs guardados: ${id} · ${inputs.competitors.length} concorrente(s)`,
  );
  await writeFile(temp, JSON.stringify(record, null, 2));
  await rename(temp, file);
  return record;
}
export async function readInputs(dir: string, id: string) {
  try {
    return JSON.parse(await readFile(path.join(dir, id + ".json"), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
