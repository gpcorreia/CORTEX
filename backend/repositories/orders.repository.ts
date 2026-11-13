import { supabase } from "../configs/supabase.js";


export async function getOrdersByCampaign(campaignId: string,productId: string, date: string): Promise<any[]> {
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const nextDayStart = new Date(dayStart);
    nextDayStart.setUTCDate(nextDayStart.getUTCDate() + 1);

    const { data, error } = await supabase
        .from("ec_orders")
        .select("*")
        .eq("campaign_id", campaignId)
        .gte("ordered_at", dayStart.toISOString())
        .lt("ordered_at", nextDayStart.toISOString());
    
    if(error || !data) {
        throw new Error(`Erro ao buscar pedidos: ${error?.message ?? "resposta vazia"}`);
    }   

    return data;
}


export async function insertOrders(orders: any[]): Promise<any[]> {

    const { data, error } = await supabase
        .from("ec_orders")
        .insert(orders)
        .select();

    if(error || !data) {
        throw new Error(`Erro ao inserir pedidos: ${error?.message ?? "resposta vazia"}`);
    }

    return data;
}

export async function getAllInfoDashboardFromDatabase(): Promise<any[]> {

    const { data, error } = await supabase
        .from("ec_orders")
        .select("campaign_id, product_id, revenue_eur, ordered_at , ec_campaigns(id,cogs_eur,revenue_eur,profit_eur)");

    if(error || !data) {
        throw new Error(`Erro ao buscar pedidos: ${error?.message ?? "resposta vazia"}`);
    }   

    return data;
}
