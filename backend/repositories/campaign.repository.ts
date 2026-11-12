import { getSupabase } from "../configs/supabase.js";

type Campaign = {
    id: string;
    productId: string;
    name: string;
    external_campaign_id: string | null;
    funnel_url: string;
    started_on: string;
    ended_on?: string | null;
    status: "planned" | "active" | "paused" | "killed" | "completed";
    daily_budget_eur: number;
};

export type CampaignForOrderAssignment = Pick<
  Campaign,
  "id" | "productId" | "started_on" | "ended_on" | "status"
>;



type CampaignInput = Omit<Campaign, "id">;

export async function createCampaign(campaign: CampaignInput): Promise<Campaign> {
    const supabase = getSupabase();

    const { productId, ...payload } = campaign;

    const { data: product, error: productError } = await supabase
        .from("ec_products")
        .select("store_id")
        .eq("id", productId)
        .maybeSingle();

    if (productError || !product) {
        throw new Error(`Erro ao obter a loja do produto: ${productError?.message ?? "produto não encontrado"}`);
    }

    const { data, error } = await supabase
        .from("ec_campaigns")
        .insert({ ...payload, product_id: productId, store_id: product.store_id })
        .select()
        .single();

    if (error || !data) {
        throw new Error(`Erro ao criar a campanha: ${error?.message ?? "resposta vazia"}`);
    }

    return { ...data, productId: data.product_id } as Campaign;
}


export async function getCampaign(campaignId: string): Promise<Campaign | null> {
    const supabase = getSupabase();

    const { data, error } = await supabase
        .from("ec_campaigns")
        .select("*")
        .eq("id", campaignId)
        .single();


    if (error || !data) {
        return null;
    }

    return { ...data, productId: data.product_id } as Campaign;
}

export async function deactivateCampaign(campaignId: string): Promise<Campaign | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase
        .from("ec_campaigns")
        .update({
            status: "completed",
            ended_on: new Date().toISOString().slice(0, 10),
        })
        .eq("id", campaignId)
        .select()
        .maybeSingle();

    if (error) throw new Error(`Erro ao desativar a campanha: ${error.message}`);
    return data ? { ...data, productId: data.product_id } as Campaign : null;
}

export async function getCampaignsForOrderAssignment(): Promise<CampaignForOrderAssignment[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
        .from("ec_campaigns")
        .select("id, product_id, started_on, ended_on, status");

    if (error) throw new Error(`Erro ao buscar campanhas: ${error.message}`);
    return (data ?? []).map((campaign) => ({
        ...campaign,
        productId: campaign.product_id,
    })) as CampaignForOrderAssignment[];
}



export async function insertDailyStatus(campaignId: string, date: string, daily: any): Promise<any> {
    const supabase = getSupabase();

    const {data, error } = await supabase
        .from("ec_campaign_daily_stats")
        .insert({ 
            campaign_id: campaignId, 
            ad_spend_eur : daily.ad_spend_eur,
            revenue_eur : daily.revenue_eur,
            cogs_eur:daily.cogs_eur,
            profit_eur: daily.profit_eur,
            roas:daily.roas,
            total_orders:daily.totalOrders,
            date:date
        }).select();

    if (error) {
        throw new Error(`Erro ao inserir o status diário da campanha: ${error?.message ?? "resposta vazia"}`);
    }

    return data;
}


export async function getCampaignHistory(campaignId: string, started_on: string, date: string): Promise<any[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
        .from("ec_campaign_daily_stats")
        .select("*")
        .eq("campaign_id", campaignId)
        .gte("date", started_on)
        .lte("date", date)
        .order("date", { ascending: false })
        .limit(3);

    if (error) {
        throw new Error(`Erro ao buscar o histórico da campanha: ${error?.message ?? "resposta vazia"}`);
    }

    return data ?? [];
}

export async function getAllInfoCampaigns() {

    const supabase = getSupabase();

    const { data, error } = await supabase.from("ec_campaigns").select("ads_spend_eur.sum(), revenue_eur.sum(), cogs_eur.sum(), profit_eur.sum()");

    if (error || !data) {
        throw new Error(`Erro ao buscar informações das campanhas: ${error?.message ?? "resposta vazia"}`);
    }

    return data;
}
