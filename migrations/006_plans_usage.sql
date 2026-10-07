-- 006_plans_usage.sql
-- Free / Monthly / Quarterly plans, monthly usage counters, per-scan cost log.
-- Run in the Supabase SQL editor AFTER 005. Safe to run more than once.
-- Limits stay OFF until you run, at launch:
--   update public.app_settings set value = 'true' where key = 'plans_enforced';

create table if not exists public.app_settings (
  key text primary key,
  value text not null
);
insert into public.app_settings (key, value) values ('plans_enforced', 'false') on conflict (key) do nothing;
alter table public.app_settings enable row level security; -- no policies: server only

-- One row per paying user. No row (or an expired one) means the Free plan.
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'monthly', 'quarterly')),
  status text not null default 'active',
  is_trial boolean not null default false,
  current_period_end timestamptz,
  provider text,
  provider_ref text,
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
drop policy if exists "read own subscription" on public.subscriptions;
create policy "read own subscription" on public.subscriptions for select using (user_id = auth.uid());
-- Only the server (service role) writes subscriptions.

-- How much of a monthly allowance has been used (scans, invoices sent).
create table if not exists public.usage_counters (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  period date not null,
  used integer not null default 0,
  primary key (user_id, kind, period)
);
alter table public.usage_counters enable row level security; -- no policies: server only

-- Takes one unit if the limit allows it. Returns the new count, or -1 when the limit is reached.
create or replace function public.consume_usage(p_user uuid, p_kind text, p_period date, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v integer;
begin
  insert into usage_counters (user_id, kind, period, used) values (p_user, p_kind, p_period, 0)
    on conflict do nothing;
  update usage_counters set used = used + 1
    where user_id = p_user and kind = p_kind and period = p_period and (p_limit is null or used < p_limit)
    returning used into v;
  return coalesce(v, -1);
end;
$$;

create or replace function public.refund_usage(p_user uuid, p_kind text, p_period date)
returns void
language sql
security definer
set search_path = public
as $$
  update usage_counters set used = greatest(used - 1, 0)
    where user_id = p_user and kind = p_kind and period = p_period;
$$;

revoke all on function public.consume_usage(uuid, text, date, integer) from public, anon, authenticated;
revoke all on function public.refund_usage(uuid, text, date) from public, anon, authenticated;
grant execute on function public.consume_usage(uuid, text, date, integer) to service_role;
grant execute on function public.refund_usage(uuid, text, date) to service_role;

-- What each receipt scan really cost (whatever usage numbers the AI service returned).
create table if not exists public.scan_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  model text,
  usage jsonb,
  created_at timestamptz not null default now()
);
alter table public.scan_log enable row level security; -- no policies: server only

-- Free plan: one business. Paid: three. Only checked when plans_enforced = 'true'.
-- Businesses you already have are never removed; this only stops creating new ones.
create or replace function public.enforce_business_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_plan text; v_end timestamptz; v_max integer; v_count integer; v_on text;
begin
  select value into v_on from app_settings where key = 'plans_enforced';
  if coalesce(v_on, 'false') <> 'true' then return new; end if;
  select plan, current_period_end into v_plan, v_end from subscriptions where user_id = new.owner_id;
  if v_plan is null or v_plan = 'free' or (v_end is not null and v_end < now()) then v_max := 1; else v_max := 3; end if;
  select count(*) into v_count from businesses where owner_id = new.owner_id;
  if v_count >= v_max then
    raise exception 'plan_limit_businesses' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists businesses_plan_limit on public.businesses;
create trigger businesses_plan_limit before insert on public.businesses
  for each row execute function public.enforce_business_limit();
