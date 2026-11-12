import { createHash } from "node:crypto";
export interface Product {
  id: string;
  name: string;
  approved: boolean;
  tested: boolean;
  fields: Record<string, string>;
}

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("CSV incompleto.");
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function productsFromCsv(csv: string): Product[] {
  const [header, ...rows] = parseCsv(csv.replace(/^\uFEFF/, ""));

  if (!header?.includes("Product name") || !header.includes("Worth testing?"))
    throw new Error(
      "As colunas Product name e Worth testing? não foram encontradas.",
    );
  return rows
    .map((c) =>
      Object.fromEntries(header.map((h, i) => [h, c[i]?.trim() ?? ""])),
    )
    .filter((f) => f["Product name"])
    .map((fields) => ({
      id: createHash("sha256")
        .update(
          JSON.stringify([
            fields["Product name"],
            fields["Competitor ad link"],
            fields["Competitor store link"],
          ]),
        )
        .digest("hex")
        .slice(0, 24),
      name: fields["Product name"],
      approved: fields["Worth testing?"].toLowerCase() === "yes",
      tested: fields.TESTED?.toLowerCase() === "true",
      fields,
    }));
}

export async function loadResearch(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (
    !response.ok ||
    response.headers.get("content-type")?.includes("text/html")
  )
    throw new Error(
      "Não foi possível ler a spreadsheet. Confirma as permissões de leitura.",
    );
  const csv = await response.text();

  if (csv.length > 5_000_000) throw new Error("Spreadsheet demasiado grande.");
  return productsFromCsv(csv);
}

export function competitorDomains(listings: string[]): string[] {
  const domains = new Set<string>();
  for (const listing of listings) {
    // Some spreadsheet cells contain multiple store URLs separated by // or whitespace.
    const candidates =
      listing.match(/https?:\/\/[^\s<>"|,;]+/gi) ?? listing.split(/\s+/);
    for (const candidate of candidates) {
      try {
        const url = new URL(
          candidate.includes("://") ? candidate : `https://${candidate}`,
        );
        const domain = url.hostname
          .toLowerCase()
          .replace(/^www\./, "")
          .replace(/\.$/, "");
        if (
          ["http:", "https:"].includes(url.protocol) &&
          domain.includes(".") &&
          !url.username &&
          !url.password
        )
          domains.add(domain);
      } catch {
        /* Invalid cells must not break the research list. */
      }
    }
  }
  return [...domains].sort();
}

export function getFacebookCompetitorAdsUrl(
  listingUrl: string | string[],
): string[] {
  return competitorDomains(
    Array.isArray(listingUrl) ? listingUrl : [listingUrl],
  ).map((domain) => {
    const url = new URL("https://www.facebook.com/ads/library/");
    url.search = new URLSearchParams({
      active_status: "active",
      ad_type: "all",
      country: "ALL",
      is_targeted_country: "false",
      media_type: "all",
      q: `https://${domain}`,
      search_type: "keyword_unordered",
      "sort_data[direction]": "desc",
      "sort_data[mode]": "total_impressions",
    }).toString();
    return url.href;
  });
}

export function competitorsFromProducts(products: Product[]) {
  const byDomain = new Map<string, Set<string>>();
  for (const product of products) {
    for (const domain of competitorDomains([
      product.fields["Competitor store link"] ?? "",
    ])) {
      if (!byDomain.has(domain)) byDomain.set(domain, new Set());
      byDomain.get(domain)!.add(product.id);
    }
  }
  return [...byDomain]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domain, ids]) => ({
      domain,
      storeUrl: `https://${domain}`,
      adsUrl: getFacebookCompetitorAdsUrl(domain)[0],
      productCount: ids.size,
    }));
}
