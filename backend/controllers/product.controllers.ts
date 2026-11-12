import type { Request, Response } from "express";
import { createProduct, getAllProducts } from "../repositories/product.repository.js";

function moneyField(value: unknown): number {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

export const getProducts = async (_req: Request, res: Response) => {
  const products = await getAllProducts();
  res.json({ products });
};

export const handleProductCreation = async (req: Request, res: Response) => {
    
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const sku = typeof req.body?.sku === "string" ? req.body.sku.trim() : "";
  const shopifyProductValue = typeof req.body?.shopify_product_id === "string" ? req.body.shopify_product_id.trim() : "";
  const shopify_product_id = shopifyProductValue.split("/").at(-1) ?? "";
  const supplier_url = typeof req.body?.supplier_url === "string" ? req.body.supplier_url.trim() : "";
  const unit_cost_eur = moneyField(req.body?.unit_cost_eur);
  const default_shipping_eur = moneyField(req.body?.default_shipping_eur);
  const status = typeof req.body?.status === "string" && (req.body.status === "active" || req.body.status === "inactive") ? req.body.status : "inactive";
  const image = req.file;



    if (!name?.trim() || name.trim().length > 100) {
        return res.status(400).json({
            message: "Preenche o nome do produto.",
        });
    }
    
    try{
        const newProduct = await createProduct({ name: name.trim(), sku: sku, shopify_product_id: shopify_product_id, supplier_url: supplier_url, unit_cost_eur: unit_cost_eur, default_shipping_eur: default_shipping_eur, status: status }, image);


        res.status(201).json({
            message: `Produto ${name} criado com sucesso.`,
            product: newProduct,
        });
    }catch (error) {
        console.error("Erro ao criar o produto:", error);
        res.status(500).json({ 
            message: error instanceof Error ? error.message : "Erro ao criar o produto.",
        });
    }
};



