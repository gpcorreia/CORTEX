import { shopifyQuery } from "../configs/shopify.js";
import {
  getProductsByShopifyIds,
  type ProductOrderMapping,
} from "../repositories/product.repository.js";

type ShopifyLineItem = {
  quantity: number;
  sku: string | null;
  product: { id: string } | null;
};

type ShopifyOrder = {
  id: string;
  name: string;
  createdAt: string;
  customer: { id: string } | null;
  cancelledAt: string | null;
  displayFinancialStatus: string;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  totalRefundedSet: { shopMoney: { amount: string; currencyCode: string } };
  lineItems: { nodes: ShopifyLineItem[]; pageInfo: { hasNextPage: boolean } };
};

export type MappedShopifyOrder = {
  store_id: string;
  product_id: string;
  campaign_id: null;
  consumer_id: string | null;
  shopify_order_id: string;
  order_number: string;
  ordered_at: string;
  quantity: number | null;
  revenue_eur: number;
  unit_cost_eur: number;
  shipping_cost_eur: number;
};

const shopifyProductId = (gid: string) => gid.split("/").at(-1) ?? gid;
const money = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;

function quantityFromSku(sku: string | null): number | null {
  const quantity = Number(sku?.split("_")[0]);
  return Number.isInteger(quantity) && quantity > 0 ? quantity : null;
}

function productFor(
  item: ShopifyLineItem,
  products: Map<string, ProductOrderMapping>,
) {
  const id = item.product?.id;
  return id ? products.get(shopifyProductId(id)) : undefined;
}

export async function mappingShopifyOrders(orders: ShopifyOrder[]): Promise<MappedShopifyOrder[]> {
  const productIds = orders.flatMap((order) =>
    order.lineItems.nodes.flatMap((item) => item.product ? [item.product.id, shopifyProductId(item.product.id)] : []),
  );
  const products = await getProductsByShopifyIds(productIds);
  const byShopifyId = new Map(products.map((product) => [shopifyProductId(product.shopify_product_id), product]));

  return orders.flatMap((order) => {
    // Store one local order per Shopify order. The first line item is the
    // physical product; Shopify's order total already includes Express Priority
    // when it was purchased in the same checkout.
    const item = order.lineItems.nodes[0];
    if (!item) return [];
    const product = productFor(item, byShopifyId);
    if (!product) return [];

    const quantity = quantityFromSku(item.sku);

    return [{
      store_id: product.store_id,
      product_id: product.id,
      campaign_id: null,
      consumer_id: order.customer ? shopifyProductId(order.customer.id) : null,
      shopify_order_id: shopifyProductId(order.id),
      order_number: order.name,
      ordered_at: order.createdAt,
      quantity,
      revenue_eur: money(Number(order.currentTotalPriceSet.shopMoney.amount)),
      unit_cost_eur: Number(product.unit_cost_eur),
      shipping_cost_eur: Number(product.default_shipping_eur),
    }];
  });
}

export async function readShopifyOrders(
  from: string,
  to: string,
  after: string | null,
) {
  const shopifyOrders = await shopifyQuery<{
    orders: {
      nodes: ShopifyOrder[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  }>(
    `query Orders($filter: String!, $after: String) {
      orders(first: 50, after: $after, sortKey: CREATED_AT, query: $filter) {
        nodes { id name createdAt customer { id } cancelledAt displayFinancialStatus
          currentTotalPriceSet { shopMoney { amount currencyCode } }
          totalRefundedSet { shopMoney { amount currencyCode } }
          lineItems(first: 100) { nodes { quantity sku product { id } } pageInfo { hasNextPage } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    { filter: `created_at:>=${from} created_at:<=${to}`, after },
  );
  
  return {
    pageInfo: shopifyOrders.orders.pageInfo,
    ShopifyOrders : await mappingShopifyOrders(shopifyOrders.orders.nodes),
  };
}
