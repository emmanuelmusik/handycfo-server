-- 005_invoice_profile_items.sql
-- Business profile (address, tax numbers, bank), customer details, invoice
-- line items and sequential invoice numbers.
-- Run in the Supabase SQL editor. Safe to run more than once.

-- ---------- business profile ----------
alter table public.businesses
  add column if not exists country text not null default 'AT',
  add column if not exists legal_name text,
  add column if not exists street text,
  add column if not exists postal_code text,
  add column if not exists city text,
  add column if not exists region text,                 -- state / province (needed for US addresses)
  add column if not exists tax_number text,             -- Steuernummer, EIN, company tax number. NOT a VAT/UID number.
  add column if not exists tax_mode text not null default 'vat',   -- vat | small_business | sales_tax | none
  add column if not exists default_tax_rate numeric(5,2) not null default 20,
  add column if not exists payment_terms_days integer not null default 14,
  add column if not exists bank_holder text,
  add column if not exists bank_iban text,
  add column if not exists bank_bic text,
  add column if not exists bank_name text,
  add column if not exists bank_account_number text,    -- US/UK style account number
  add column if not exists bank_routing_code text,      -- US routing number or UK sort code
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists website text,
  add column if not exists invoice_prefix text not null default 'INV',
  add column if not exists invoice_start_number integer not null default 1,
  add column if not exists invoice_language text not null default 'en',
  add column if not exists invoice_footer text;

-- vat_number (already there) is the UID / VAT registration number.
comment on column public.businesses.tax_number is 'Tax number such as the Austrian Steuernummer or a US EIN. Never a UID/VAT number.';
comment on column public.businesses.vat_number is 'UID / VAT registration number (e.g. ATU12345678). Separate from tax_number.';

do $$ begin
  alter table public.businesses add constraint businesses_tax_mode_check
    check (tax_mode in ('vat', 'small_business', 'sales_tax', 'none'));
exception when duplicate_object then null; end $$;

-- ---------- customers (contacts) ----------
alter table public.contacts
  add column if not exists street text,
  add column if not exists postal_code text,
  add column if not exists city text,
  add column if not exists region text,
  add column if not exists country text,
  add column if not exists tax_id text,                 -- customer UID / VAT number / EIN
  add column if not exists language text;               -- language their invoices are written in

-- ---------- invoices ----------
alter table public.invoices
  add column if not exists invoice_number text,
  add column if not exists service_date date,
  add column if not exists service_end_date date,
  add column if not exists net_amount numeric(12,2),
  add column if not exists vat_amount numeric(12,2) not null default 0,
  add column if not exists prices_include_tax boolean not null default false,
  add column if not exists invoice_mode text not null default 'full',   -- full | simplified (small-value)
  add column if not exists tax_mode text,
  add column if not exists language text not null default 'en',
  add column if not exists notes text,
  add column if not exists payment_reference text,
  add column if not exists client_street text,
  add column if not exists client_postal_code text,
  add column if not exists client_city text,
  add column if not exists client_region text,
  add column if not exists client_country text,
  add column if not exists client_tax_id text,
  add column if not exists seller_snapshot jsonb;       -- seller details frozen when the invoice is sent

do $$ begin
  alter table public.invoices add constraint invoices_mode_check check (invoice_mode in ('full', 'simplified'));
exception when duplicate_object then null; end $$;

-- Invoices that already exist keep the number they were sent with (the short id).
update public.invoices set invoice_number = upper(left(id::text, 8)) where invoice_number is null;

create unique index if not exists invoices_number_unique
  on public.invoices (business_id, invoice_number) where invoice_number is not null;

-- ---------- line items ----------
create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  position integer not null default 0,
  description text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  tax_rate numeric(5,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100)
);

create index if not exists invoice_items_invoice_idx on public.invoice_items(invoice_id, position);

alter table public.invoice_items enable row level security;

drop policy if exists "own invoice items" on public.invoice_items;
create policy "own invoice items" on public.invoice_items
  for select using (
    exists (
      select 1 from public.invoices i
      join public.businesses b on b.id = i.business_id
      where i.id = invoice_id and b.owner_id = auth.uid()
    )
  );
-- Writes go through the server (service role), which checks ownership and does the maths.

-- ---------- sequential invoice numbers ----------
create table if not exists public.invoice_counters (
  business_id uuid not null references public.businesses(id) on delete cascade,
  year integer not null,
  last_number integer not null,
  primary key (business_id, year)
);

alter table public.invoice_counters enable row level security;  -- no policies: server only

-- Hands out the next number for a business and year, one at a time, with no gaps or repeats.
create or replace function public.allocate_invoice_number(p_business uuid, p_year integer, p_start integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  insert into public.invoice_counters (business_id, year, last_number)
  values (p_business, p_year, greatest(p_start, 1))
  on conflict (business_id, year)
  do update set last_number = public.invoice_counters.last_number + 1
  returning last_number into n;
  return n;
end;
$$;

revoke all on function public.allocate_invoice_number(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.allocate_invoice_number(uuid, integer, integer) to service_role;
