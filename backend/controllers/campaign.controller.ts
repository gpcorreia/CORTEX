import type { Request, Response } from "express";
import { createCampaign, deactivateCampaign, getCampaign, insertDailyStatus, getCampaignHistory, getCampaignsForOrderAssignment, getAllInfoCampaigns} from "../repositories/campaign.repository.js";
import { getOrdersByCampaign } from "../repositories/orders.repository.js";
import {calculateDailyMetrics,calculateAverageMetrics} from "../services/campaign.services.js";
import {getProductShopifyId} from "../repositories/product.repository.js";


type dailyStatus = {
    campaign_id: string;
    date: string;
    ad_spent_eur: number;
};


export const handleCampaignCreation = async (req: Request, res: Response) => {
    
  const productId = typeof req.body?.productId === "string" ? req.body.productId.trim() : "";
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const external_campaign_id = typeof req.body?.external_campaign_id === "string" ? req.body.external_campaign_id.trim() : "";
  const funnel_url = typeof req.body?.funnel_url === "string" ? req.body.funnel_url.trim() : "";
  const started_on = typeof req.body?.started_on === "string" ? req.body.started_on.trim() : "";
  const status = typeof req.body?.status === "string" && (req.body.status === "active" || req.body.status === "planned") ? req.body.status : "planned";
  const daily_budget_eur = typeof req.body?.daily_budget_eur === "number" && Number.isFinite(req.body.daily_budget_eur) ? req.body.daily_budget_eur : 0;


    if (!name || name.length > 100 || !productId || !funnel_url || !/^\d{4}-\d{2}-\d{2}$/.test(started_on)) {
        return res.status(400).json({
            message: "Preenche os dados obrigatórios da campanha.",
        });
    }
    
    try{
        const newCampaign = await createCampaign({productId: productId.trim(), name: name.trim(), external_campaign_id: external_campaign_id || null, funnel_url: funnel_url.trim(), started_on: started_on, status: status, daily_budget_eur: daily_budget_eur });


        res.status(201).json({
            message: `Campanha ${name} criada com sucesso.`,
            campaign: newCampaign,
        });
    }catch (error) {
        console.error("Erro ao criar a campanha:", error);
        res.status(500).json({ 
            message: error instanceof Error ? error.message : "Erro ao criar a campanha.",
        });
    }
};

export const handleCampaignDeactivation = async (req: Request, res: Response) => {
    try {
        const campaignId = typeof req.params.id === "string" ? req.params.id : "";
        const campaign = campaignId ? await deactivateCampaign(campaignId) : null;
        if (!campaign) {
            res.status(404).json({ message: "Campanha não encontrada." });
            return;
        }
        res.json({ message: "Campanha desativada com sucesso.", campaign });
    } catch (error) {
        console.error("Erro ao desativar a campanha:", error);
        res.status(500).json({ message: "Erro ao desativar a campanha." });
    }
};



export const handleCampaingDailyStatus = async (req: Request, res: Response) => {

    const campaignId = typeof req.body?.campaignId === "string" ? req.body.campaignId.trim() : "";
    const date = typeof req.body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date) ? req.body.date : "";
    const ad_spent_eur = typeof req.body?.ad_spent_eur === "number" && Number.isFinite(req.body.ad_spent_eur) ? req.body.ad_spent_eur : 0;

    if (!campaignId || !date) {
        return res.status(400).json({
            message: "Preenche os dados obrigatórios da campanha.",
        });
    }

    const campaign = await getCampaign(campaignId);

    if(!campaign) {
        return res.status(404).json({
            message: "Campanha não encontrada.",
        });
    }

    const orders = await getOrdersByCampaign(campaign.id,campaign.productId, date);

    const daily = await calculateDailyMetrics(orders,ad_spent_eur);

    const dailyInsert = await insertDailyStatus(campaignId, date, daily);

    if(!dailyInsert){
        throw Error(`Erro ao inserir o status diário da campanha: ${dailyInsert?.message ?? "resposta vazia"}`);
    }

    const history = await getCampaignHistory(campaignId,campaign?.started_on,date);

    const average = await calculateAverageMetrics(history);

    return res.status(200).json({
        message: "Dados diários da campanha enviados com sucesso.",
        dailyMetrics: daily,
        averageMetrics: average,
        history: history,
    });


}


export const handleAllCampaign = async (req: Request, res: Response) => {
    try {
        const campaigns = await getAllInfoCampaigns();

        res.status(200).json({
            message: "Campanhas obtidas com sucesso.",
            campaigns: campaigns,
        });
    }
    catch (error) {
        console.error("Erro ao obter campanhas:", error);
        res.status(500).json({ message: "Erro ao obter campanhas." });
    }
}


