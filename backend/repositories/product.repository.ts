import { supabase } from "../configs/supabase.js";

type Product = {
  id: string;
  store_id: string;
  name: string;
  sku: string;
  shopify_product_id: string;
  supplier_url: string;
  unit_cost_eur: number;
  default_shipping_eur: number;
  status: "active" | "inactive";
  image_url: string | null;
};

export type ProductCost = Pick<
  Product,
  "shopify_product_id" | "unit_cost_eur" | "default_shipping_eur"
>;

export type ProductOrderMapping = Pick<
  Product,
  | "id"
  | "store_id"
  | "shopify_product_id"
  | "unit_cost_eur"
  | "default_shipping_eur"
>;

export type ProductCostById = Pick<
  Product,
  "id" | "unit_cost_eur" | "default_shipping_eur"
>;



export async function createProduct(
  product: Pick<Product, "name" | "sku" | "shopify_product_id" | "supplier_url" | "unit_cost_eur" | "default_shipping_eur" | "status">,
  image?: Express.Multer.File
): Promise<Product> {

  const { data: store, error: storeError } = await supabase
    .from("ec_stores")
    .select("id")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (storeError || !store) {
    throw new Error(
      `Erro ao obter a loja ativa: ${storeError?.message ?? "nenhuma loja ativa encontrada"}`,
    );
  }

  const insertData = {
    ...product,
    store_id: store.id,
    image_url: image?.path ?? null,
  };

  const { data, error } = await supabase
    .from("ec_products")
    .insert(insertData)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Erro ao criar o produto: ${error?.message ?? "resposta vazia"}`);
  }

  return data as Product;
}


export async function getAllProducts(): Promise<Product[]> {

  const { data, error } = await supabase.from("ec_products").select("*");
  if (error) {
    throw new Error(`Erro ao buscar produtos: ${error.message}`);
  }
  return data as Product[];
}


export async function getProductShopifyId(productId: string): Promise<string | null> {

  const { data, error } = await supabase
    .from("ec_products")
    .select("shopify_product_id")
    .eq("id", productId)
    .single();

    if (error || !data) {
    return null;
  }
  return data.shopify_product_id;
}

export async function getProductById(
  productId: string,
): Promise<ProductCost | null> {

  const { data, error } = await supabase
    .from("ec_products")
    .select("product_id, unit_cost_eur, default_shipping_eur")
    .eq("id", productId)
    .maybeSingle();

  if (error) throw new Error(`Erro ao buscar produto: ${error.message}`);
  return data as ProductCost | null;
}

export async function getProductsByShopifyIds(
  shopifyProductIds: string[],
): Promise<ProductOrderMapping[]> {
  const ids = [...new Set(shopifyProductIds.filter(Boolean))];
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from("ec_products")
    .select("id, store_id, shopify_product_id, unit_cost_eur, default_shipping_eur")
    .in("shopify_product_id", ids);

  if (error) throw new Error(`Erro ao buscar produtos: ${error.message}`);
  return (data ?? []) as ProductOrderMapping[];
}

export async function getProductsCostsByIds(
  productIds: string[],
): Promise<ProductCostById[]> {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from("ec_products")
    .select("id, unit_cost_eur, default_shipping_eur")
    .in("id", ids);

  if (error) throw new Error(`Erro ao buscar custos dos produtos: ${error.message}`);
  return (data ?? []) as ProductCostById[];
}
