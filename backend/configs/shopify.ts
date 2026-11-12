import { env } from "./env.js";

export function shopifyConfiguration() {
  const domain = env.shopifyDomain.toLowerCase();
  if (!domain || !env.shopifyToken)
    throw Object.assign(
      new Error(
        "Configura SHOPIFY_SHOP_DOMAIN e SHOPIFY_ADMIN_ACCESS_TOKEN no .env.",
      ),
      { status: 503 },
    );
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain))
    throw Object.assign(
      new Error(
        "SHOPIFY_SHOP_DOMAIN deve ser o domínio nome.myshopify.com, sem https://.",
      ),
      { status: 503 },
    );
  if (!/^\d{4}-(01|04|07|10)$/.test(env.shopifyVersion))
    throw Object.assign(new Error("SHOPIFY_API_VERSION inválida."), {
      status: 503,
    });
  return { domain, token: env.shopifyToken, version: env.shopifyVersion };
}
export function shopifyStatus() {
  return {
    configured: Boolean(env.shopifyDomain && env.shopifyToken),
    apiVersion: env.shopifyVersion,
  };
}
export async function shopifyQuery<T>(
  query: string,
  variables: Record<string, unknown>,
  request: typeof fetch = fetch,
): Promise<T> {
  const { domain, token, version } = shopifyConfiguration();
  let response: Response;
  try {
    response = await request(
      `https://${domain}/admin/api/${version}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      },
    );
  } catch {
    throw Object.assign(new Error("Não foi possível contactar o Shopify."), {
      status: 502,
    });
  }
  if (!response.ok)
    throw Object.assign(
      new Error(
        `Shopify respondeu HTTP ${response.status}. Verifica o token e as permissões read_orders.`,
      ),
      { status: 502 },
    );
  const result = (await response.json()) as { data?: T; errors?: unknown[] };
  if (result.errors?.length || !result.data)
    throw Object.assign(
      new Error(
        "Shopify não disponibilizou os dados. Verifica os scopes, a versão da API e os limites de acesso.",
      ),
      { status: 502 },
    );
  return result.data;
}
