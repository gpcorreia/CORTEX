-- E-COMMERCE TRACKER | Supabase PostgreSQL | v3
-- 7 tables, no order_items, no decisions, one expenses table.
-- Assumption: each order contains ONE product type, with quantity >= 1.
-- Run once in Supabase SQL Editor. Existing tables are not dropped.
-- All financial amounts are EUR. Convert supplier costs before saving.
-- Security: RLS enabled with NO public policies. Access via trusted backend only.

create extension if not exists pgcrypto;

create table if not exists public.ec_stores (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 platform text not null default 'shopify' check (platform in ('shopify','manual')),
 shop_domain text unique,
 currency char(3) not null default 'EUR',
 status text not null default 'active' check (status in ('active','inactive')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.ec_products (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.ec_stores(id) on delete restrict,
 name text not null,
 sku text,
 shopify_product_id text,
 supplier_url text,
 unit_cost_eur numeric(14,4) not null default 0 check (unit_cost_eur >= 0),
 default_shipping_eur numeric(14,4) not null default 0 check (default_shipping_eur >= 0),
 status text not null default 'active' check (status in ('active','inactive','archived')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (id, store_id),
 unique (store_id, shopify_product_id)
);

create table if not exists public.ec_campaigns (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.ec_stores(id) on delete restrict,
 product_id uuid not null,
 name text not null,
 external_campaign_id text,
 affiliate_url text,
 started_on date not null,
 ended_on date,
 status text not null default 'planned' check (status in ('planned','active','paused','killed','completed')),
 daily_budget_eur numeric(14,2) not null default 0 check (daily_budget_eur >= 0),
 notes text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key (product_id,store_id) references public.ec_products(id,store_id) on delete restrict,
 unique (id,store_id),
 unique (id,product_id),
 check (ended_on is null or ended_on >= started_on),
 unique (store_id, external_campaign_id)
);

-- One row per campaign and calendar day. Historical revenue/cogs fields are ONLY
-- for legacy spreadsheet data not yet represented by imported orders.
create table if not exists public.ec_campaign_daily_stats (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.ec_campaigns(id) on delete cascade,
 stat_date date not null,
 ad_spend_eur numeric(14,2) not null default 0 check (ad_spend_eur >= 0),
 clicks integer check (clicks >= 0),
 impressions integer check (impressions >= 0),
 add_to_carts integer check (add_to_carts >= 0),
 legacy_revenue_eur numeric(14,2) not null default 0 check (legacy_revenue_eur >= 0),
 legacy_cogs_eur numeric(14,2) not null default 0 check (legacy_cogs_eur >= 0),
 legacy_orders_count integer not null default 0 check (legacy_orders_count >= 0),
 notes text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (campaign_id, stat_date)
);

create table if not exists public.ec_campaign_budget_history (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.ec_campaigns(id) on delete cascade,
 effective_at timestamptz not null default now(),
 budget_eur numeric(14,2) not null check (budget_eur >= 0),
 reason text,
 created_at timestamptz not null default now()
);

-- One product per order; multiple quantities allowed. For extra services
-- (e.g. priority processing), include their revenue in revenue_eur.
-- campaign_id is nullable because Shopify does not guarantee Meta attribution.
create table if not exists public.ec_orders (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.ec_stores(id) on delete restrict,
 product_id uuid not null,
 campaign_id uuid,
 shopify_order_id text,
 order_number text,
 ordered_at timestamptz not null,
 quantity integer not null check (quantity > 0),
 revenue_eur numeric(14,2) not null check (revenue_eur >= 0),
 unit_cost_eur numeric(14,4) not null default 0 check (unit_cost_eur >= 0),
 shipping_cost_eur numeric(14,4) not null default 0 check (shipping_cost_eur >= 0),
 other_cost_eur numeric(14,4) not null default 0 check (other_cost_eur >= 0),
 cost_status text not null default 'estimated' check (cost_status in ('estimated','confirmed')),
 status text not null default 'paid' check (status in ('pending','paid','fulfilled','cancelled','refunded','partially_refunded')),
 -- Revenue should be net of refunds and adjusted when refunds happen.
 notes text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 total_cogs_eur numeric(14,4) generated always as ((quantity * unit_cost_eur) + shipping_cost_eur + other_cost_eur) stored,
 foreign key (product_id,store_id) references public.ec_products(id,store_id) on delete restrict,
 foreign key (campaign_id,store_id) references public.ec_campaigns(id,store_id) on delete restrict,
 foreign key (campaign_id,product_id) references public.ec_campaigns(id,product_id) on delete restrict,
 unique (store_id,shopify_order_id)
);

-- A single table for one-time and recurring costs. One-time expenses are counted
-- on first_charge_on. Subscriptions are counted on each due date; no free-trial
-- charge until first_charge_on. monthly/yearly frequencies supported.
create table if not exists public.ec_expenses (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 category text,
 expense_type text not null check (expense_type in ('one_time','subscription')),
 amount_eur numeric(14,2) not null check (amount_eur >= 0),
 frequency text check (frequency in ('monthly','yearly')),
 first_charge_on date not null,
 last_charge_on date,
 status text not null default 'active' check (status in ('active','paused','cancelled')),
 notes text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((expense_type = 'one_time' and frequency is null) or (expense_type = 'subscription' and frequency is not null)),
 check (last_charge_on is null or last_charge_on >= first_charge_on)
);

-- Indexes
create index if not exists ec_products_store_idx on public.ec_products(store_id);
create index if not exists ec_campaigns_store_status_idx on public.ec_campaigns(store_id,status);
create index if not exists ec_campaigns_product_idx on public.ec_campaigns(product_id);
create index if not exists ec_campaign_daily_date_idx on public.ec_campaign_daily_stats(stat_date);
create index if not exists ec_campaign_budget_history_campaign_time_idx on public.ec_campaign_budget_history(campaign_id,effective_at desc);
create index if not exists ec_orders_campaign_date_idx on public.ec_orders(campaign_id,ordered_at);
create index if not exists ec_orders_store_date_idx on public.ec_orders(store_id,ordered_at);
create index if not exists ec_orders_product_idx on public.ec_orders(product_id);
create index if not exists ec_expenses_type_date_idx on public.ec_expenses(expense_type,first_charge_on);

-- Updated timestamps
create or replace function public.ec_set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
do $$ declare t text; begin
 foreach t in array array['ec_stores','ec_products','ec_campaigns','ec_campaign_daily_stats','ec_orders','ec_expenses'] loop
  execute format('drop trigger if exists %I on public.%I',t||'_updated_at',t);
  execute format('create trigger %I before update on public.%I for each row execute function public.ec_set_updated_at()',t||'_updated_at',t);
 end loop;
end $$;

-- Daily reporting: imported orders plus spreadsheet-only legacy totals.
-- IMPORTANT: before importing an old day's Shopify orders, clear/reconcile the
-- corresponding legacy_revenue/cogs/orders_count to prevent double counting.
create or replace view public.ec_v_campaign_daily as
with o as (
 select campaign_id, (ordered_at at time zone 'Europe/Lisbon')::date as stat_date,
 sum(revenue_eur) as revenue_eur, sum(total_cogs_eur) as cogs_eur, count(*)::integer as orders_count
 from public.ec_orders
 where campaign_id is not null and status not in ('cancelled')
 group by campaign_id,(ordered_at at time zone 'Europe/Lisbon')::date
),
keys as (
 select campaign_id,stat_date from public.ec_campaign_daily_stats
 union
 select campaign_id,stat_date from o
)
select k.campaign_id,k.stat_date,
 coalesce(s.ad_spend_eur,0)::numeric(14,2) as ad_spend_eur,
 (coalesce(o.revenue_eur,0)+coalesce(s.legacy_revenue_eur,0))::numeric(14,2) as revenue_eur,
 (coalesce(o.cogs_eur,0)+coalesce(s.legacy_cogs_eur,0))::numeric(14,2) as cogs_eur,
 (coalesce(o.orders_count,0)+coalesce(s.legacy_orders_count,0))::integer as orders_count,
 (coalesce(o.revenue_eur,0)+coalesce(s.legacy_revenue_eur,0)-coalesce(o.cogs_eur,0)-coalesce(s.legacy_cogs_eur,0)-coalesce(s.ad_spend_eur,0))::numeric(14,2) as profit_eur,
 round((coalesce(o.revenue_eur,0)+coalesce(s.legacy_revenue_eur,0))/nullif(s.ad_spend_eur,0),3) as roas,
 round((coalesce(o.revenue_eur,0)+coalesce(s.legacy_revenue_eur,0))/nullif((coalesce(o.revenue_eur,0)+coalesce(s.legacy_revenue_eur,0)-coalesce(o.cogs_eur,0)-coalesce(s.legacy_cogs_eur,0)),0),3) as break_even_roas
from keys k
left join public.ec_campaign_daily_stats s on s.campaign_id=k.campaign_id and s.stat_date=k.stat_date
left join o on o.campaign_id=k.campaign_id and o.stat_date=k.stat_date;

create or replace view public.ec_v_campaign_totals as
select c.id as campaign_id,c.name,c.status,c.store_id,c.product_id,
 coalesce(sum(d.ad_spend_eur),0)::numeric(14,2) as ad_spend_eur,
 coalesce(sum(d.revenue_eur),0)::numeric(14,2) as revenue_eur,
 coalesce(sum(d.cogs_eur),0)::numeric(14,2) as cogs_eur,
 coalesce(sum(d.orders_count),0)::integer as orders_count,
 coalesce(sum(d.profit_eur),0)::numeric(14,2) as profit_eur,
 round(sum(d.revenue_eur)/nullif(sum(d.ad_spend_eur),0),3) as roas,
 case when sum(d.revenue_eur)-sum(d.cogs_eur)>0 then round(sum(d.revenue_eur)/nullif(sum(d.revenue_eur)-sum(d.cogs_eur),0),3) end as break_even_roas
from public.ec_campaigns c left join public.ec_v_campaign_daily d on d.campaign_id=c.id
group by c.id,c.name,c.status,c.store_id,c.product_id;

-- Monthly expense schedule (due/forecast, NOT proof of payment).
-- Change the date range when querying if you need longer projections.
create or replace view public.ec_v_expense_schedule as
select e.id as expense_id,e.name,e.category,e.expense_type,e.amount_eur,
 (case when e.expense_type='one_time' then e.first_charge_on else x.due_on end)::date as due_on,
 e.status
from public.ec_expenses e
left join lateral (
 select gs::date as due_on from generate_series(
 e.first_charge_on::timestamp,
 (current_date + interval '24 months')::timestamp,
 case when e.frequency='yearly' then interval '1 year' else interval '1 month' end
 ) gs
 where e.expense_type='subscription'
) x on true
where (e.expense_type='one_time' or x.due_on is not null)
 and (e.last_charge_on is null or coalesce(x.due_on::date,e.first_charge_on)<=e.last_charge_on)
 and (e.expense_type='one_time' or e.status='active');

-- Global profitability including all campaign data, plus orders with no
-- campaign attribution. Subscriptions are scheduled liabilities, not verified
-- bank payments. For accurate realized cash flow, add payment events later.
create or replace view public.ec_v_business_overview as
with campaigns as (
 select coalesce(sum(ad_spend_eur),0) as spend,coalesce(sum(revenue_eur),0) as revenue,
 coalesce(sum(cogs_eur),0) as cogs from public.ec_v_campaign_daily
), unattributed as (
 select coalesce(sum(revenue_eur),0) as revenue,coalesce(sum(total_cogs_eur),0) as cogs
 from public.ec_orders where campaign_id is null and status <> 'cancelled'
), expenses as (
 select coalesce(sum(amount_eur),0) as scheduled_cost
 from public.ec_v_expense_schedule where due_on <= current_date
)
select (c.revenue+u.revenue)::numeric(14,2) as revenue_eur,
 c.spend::numeric(14,2) as ad_spend_eur,
 (c.cogs+u.cogs)::numeric(14,2) as cogs_eur,
 e.scheduled_cost::numeric(14,2) as scheduled_expenses_eur,
 (c.revenue+u.revenue-c.cogs-u.cogs-c.spend-e.scheduled_cost)::numeric(14,2) as estimated_profit_eur,
 round((c.revenue+u.revenue)/nullif(c.spend,0),3) as roas
from campaigns c cross join unattributed u cross join expenses e;

-- Security: only backend service role should access tables/views initially.
alter table public.ec_stores enable row level security;
alter table public.ec_products enable row level security;
alter table public.ec_campaigns enable row level security;
alter table public.ec_campaign_daily_stats enable row level security;
alter table public.ec_campaign_budget_history enable row level security;
alter table public.ec_orders enable row level security;
alter table public.ec_expenses enable row level security;
revoke all on public.ec_stores,public.ec_products,public.ec_campaigns,public.ec_campaign_daily_stats,public.ec_campaign_budget_history,public.ec_orders,public.ec_expenses from anon,authenticated;
revoke all on public.ec_v_campaign_daily,public.ec_v_campaign_totals,public.ec_v_expense_schedule,public.ec_v_business_overview from anon,authenticated;
