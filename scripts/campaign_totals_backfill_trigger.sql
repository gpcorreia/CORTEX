begin;

-- Normalize the new campaign total column names so they match Daily Stats.
-- The checks make this migration safe to run again after the rename.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ec_campaigns'
      and column_name = 'reveneu_eur'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ec_campaigns'
      and column_name = 'revenue_eur'
  ) then
    alter table public.ec_campaigns
      rename column reveneu_eur to revenue_eur;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ec_campaigns'
      and column_name = 'adspend_eur'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ec_campaigns'
      and column_name = 'ad_spend_eur'
  ) then
    alter table public.ec_campaigns
      rename column adspend_eur to ad_spend_eur;
  end if;
end;
$$;

-- Existing campaigns receive their complete accumulated Daily Stats history.
update public.ec_campaigns
set revenue_eur = 0, ad_spend_eur = 0, cogs_eur = 0, profit_eur = 0;

with totals as (
  select
    stats.campaign_id,
    coalesce(sum(stats.revenue_eur), 0) as revenue_eur,
    coalesce(sum(stats.ad_spend_eur), 0) as ad_spend_eur,
    coalesce(sum(stats.cogs_eur), 0) as cogs_eur,
    coalesce(sum(stats.revenue_eur), 0)
      - coalesce(sum(stats.ad_spend_eur), 0)
      - coalesce(sum(stats.cogs_eur), 0) as profit_eur
  from public.ec_campaign_daily_stats as stats
  group by stats.campaign_id
)
update public.ec_campaigns as campaign
set
  revenue_eur = totals.revenue_eur,
  ad_spend_eur = totals.ad_spend_eur,
  cogs_eur = totals.cogs_eur,
  profit_eur = totals.profit_eur
from totals
where totals.campaign_id = campaign.id;

alter table public.ec_campaigns
  alter column revenue_eur set default 0,
  alter column revenue_eur set not null,
  alter column ad_spend_eur set default 0,
  alter column ad_spend_eur set not null,
  alter column cogs_eur set default 0,
  alter column cogs_eur set not null,
  alter column profit_eur set default 0,
  alter column profit_eur set not null;

-- Recalculate one campaign from its Daily Stats. Recalculation is deliberate:
-- it also repairs totals after a correction instead of incrementing twice.
create or replace function public.ec_recalculate_campaign_totals(
  target_campaign_id uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ec_campaigns as campaign
  set
    revenue_eur = totals.revenue_eur,
    ad_spend_eur = totals.ad_spend_eur,
    cogs_eur = totals.cogs_eur,
    profit_eur = totals.profit_eur,
    updated_at = now()
  from (
    select
      coalesce(sum(stats.revenue_eur), 0) as revenue_eur,
      coalesce(sum(stats.ad_spend_eur), 0) as ad_spend_eur,
      coalesce(sum(stats.cogs_eur), 0) as cogs_eur,
      coalesce(sum(stats.revenue_eur), 0)
        - coalesce(sum(stats.ad_spend_eur), 0)
        - coalesce(sum(stats.cogs_eur), 0) as profit_eur
    from public.ec_campaign_daily_stats as stats
    where stats.campaign_id = target_campaign_id
  ) as totals
  where campaign.id = target_campaign_id;
$$;

create or replace function public.ec_sync_campaign_totals_from_daily_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.ec_recalculate_campaign_totals(old.campaign_id);
    return old;
  end if;

  if tg_op = 'UPDATE' and old.campaign_id is distinct from new.campaign_id then
    perform public.ec_recalculate_campaign_totals(old.campaign_id);
  end if;

  perform public.ec_recalculate_campaign_totals(new.campaign_id);
  return new;
end;
$$;

drop trigger if exists ec_campaign_daily_stats_sync_campaign_totals
  on public.ec_campaign_daily_stats;

create trigger ec_campaign_daily_stats_sync_campaign_totals
after insert or update or delete on public.ec_campaign_daily_stats
for each row
execute function public.ec_sync_campaign_totals_from_daily_stats();

commit;

-- Verification query: every difference should be zero.
select
  campaign.id,
  campaign.name,
  campaign.revenue_eur - coalesce(sum(stats.revenue_eur), 0) as revenue_difference,
  campaign.ad_spend_eur - coalesce(sum(stats.ad_spend_eur), 0) as ad_spend_difference,
  campaign.cogs_eur - coalesce(sum(stats.cogs_eur), 0) as cogs_difference,
  campaign.profit_eur - (
    coalesce(sum(stats.revenue_eur), 0)
    - coalesce(sum(stats.ad_spend_eur), 0)
    - coalesce(sum(stats.cogs_eur), 0)
  ) as profit_difference
from public.ec_campaigns as campaign
left join public.ec_campaign_daily_stats as stats
  on stats.campaign_id = campaign.id
group by campaign.id, campaign.name
order by campaign.started_on desc;
