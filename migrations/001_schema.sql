-- ============================================================
-- HandyCFO — Supabase (Postgres) schema
-- Maps directly onto the prototype's data model:
-- businesses, invoices, expenses, financial-inbox documents,
-- network contacts + messages, and Dropbox connections.
--
-- Run this in the Supabase SQL editor (or via `supabase db push`
-- once it's in a migrations/ folder). auth.users is Supabase's
-- built-in auth table — everything below hangs off it.
-- ============================================================

-- ---------- extensions ----------
create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- ---------- profiles ----------
-- One row per signed-up user. Supabase creates auth.users for you;
-- this table holds the app-specific bits.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now()
);

-- ---------- businesses ----------
create type business_currency as enum ('EUR', 'USD', 'GBP');

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  business_type text,            -- e.g. "Software · Multi-venture"
  short_code text,                -- 2-letter avatar initials
  color text,                     -- hex color for the avatar chip
  vat_number text,
  currency business_currency not null default 'EUR',
  created_at timestamptz not null default now()
);

create index businesses_owner_idx on public.businesses(owner_id);

-- ---------- contacts (network: suppliers & clients) ----------
-- Contacts belong to the user, not a single business, since the
-- same supplier/client can be relevant across ventures.
create type contact_relationship as enum ('Supplier', 'Client');

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  relationship contact_relationship not null,
  on_platform boolean not null default false,   -- found on HandyCFO?
  linked_user_id uuid references auth.users(id), -- set once matched
  color text,
  created_at timestamptz not null default now()
);

create index contacts_owner_idx on public.contacts(owner_id);

-- ---------- messages (contact <-> user chat threads) ----------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  sender text not null check (sender in ('me', 'them')),
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index messages_contact_idx on public.messages(contact_id, created_at);

-- ---------- invoices (accounts receivable) ----------
create type invoice_status as enum ('Draft', 'Sent', 'Overdue', 'Paid');
create type reminder_level as enum ('none', '1st', '2nd', 'final');

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  client_contact_id uuid references public.contacts(id),
  client_name text not null,      -- denormalized for quick display / non-contact clients
  issue_date date not null default current_date,
  due_date date not null,
  amount numeric(12,2) not null check (amount >= 0),
  currency business_currency not null default 'EUR',
  status invoice_status not null default 'Draft',
  reminder_level reminder_level not null default 'none',
  auto_reminders boolean not null default true,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index invoices_business_idx on public.invoices(business_id, status);
create index invoices_due_idx on public.invoices(due_date) where status in ('Sent', 'Overdue');

-- ---------- expenses (accounts payable / recorded spend) ----------
create type receipt_provider as enum ('dropbox', 'none');

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  supplier_contact_id uuid references public.contacts(id),
  merchant text not null,
  category text not null,
  amount numeric(12,2) not null check (amount >= 0),
  vat_amount numeric(12,2) not null default 0,
  currency business_currency not null default 'EUR',
  expense_date date not null default current_date,
  receipt_provider receipt_provider not null default 'none',
  receipt_external_id text,       -- Dropbox file path/id — the image itself never lands here
  bank_matched boolean not null default false,
  bank_transaction_id text,
  created_at timestamptz not null default now()
);

create index expenses_business_idx on public.expenses(business_id, expense_date);

-- ---------- financial inbox (documents awaiting/through AI review) ----------
create type inbox_doc_state as enum ('processing', 'ready', 'reviewed');
create type inbox_doc_source as enum ('upload', 'supplier');

create table public.inbox_documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  source inbox_doc_source not null default 'upload',
  contact_id uuid references public.contacts(id), -- set when source = 'supplier'
  file_name text not null,
  state inbox_doc_state not null default 'processing',
  extracted_merchant text,
  extracted_date date,
  extracted_amount numeric(12,2),
  extracted_vat numeric(12,2),
  extracted_category text,
  receipt_provider receipt_provider not null default 'none',
  receipt_external_id text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  -- once reviewed, this points at the expense it became
  resolved_expense_id uuid references public.expenses(id)
);

create index inbox_business_idx on public.inbox_documents(business_id, state);

-- ---------- connected cloud storage (Dropbox, etc.) ----------
create type storage_provider as enum ('dropbox');

create table public.storage_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider storage_provider not null,
  account_email text,
  access_token_encrypted text not null,   -- encrypt at the app layer before insert
  refresh_token_encrypted text,
  connected_at timestamptz not null default now(),
  unique (owner_id, provider)
);

-- ============================================================
-- Reporting: compute income/expenses/profit from real rows
-- instead of storing separately-maintained totals.
-- Powers the Reports page's stat cards and trend chart.
-- ============================================================
create view public.business_monthly_summary as
select
  business_id,
  date_trunc('month', issue_date)::date as month,
  sum(amount) filter (where status = 'Paid') as income
from public.invoices
group by business_id, date_trunc('month', issue_date)
union all
select
  business_id,
  date_trunc('month', expense_date)::date as month,
  -sum(amount) as income  -- placeholder row shape; combine in application query instead if preferred
from public.expenses
group by business_id, date_trunc('month', expense_date);

-- Simpler, recommended alternative: two views, joined in the app.
create view public.business_monthly_income as
select business_id, date_trunc('month', issue_date)::date as month, sum(amount) as income
from public.invoices
where status = 'Paid'
group by business_id, date_trunc('month', issue_date);

create view public.business_monthly_expenses as
select business_id, date_trunc('month', expense_date)::date as month, sum(amount) as expenses
from public.expenses
group by business_id, date_trunc('month', expense_date);

-- ============================================================
-- Row Level Security — every table is owner-scoped.
-- businesses/contacts check owner_id directly; everything that
-- hangs off a business checks ownership via a join.
-- ============================================================
alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.contacts enable row level security;
alter table public.messages enable row level security;
alter table public.invoices enable row level security;
alter table public.expenses enable row level security;
alter table public.inbox_documents enable row level security;
alter table public.storage_connections enable row level security;

create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "own businesses" on public.businesses
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "own contacts" on public.contacts
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "own messages" on public.messages
  for all using (
    exists (select 1 from public.contacts c where c.id = contact_id and c.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.contacts c where c.id = contact_id and c.owner_id = auth.uid())
  );

create policy "own invoices" on public.invoices
  for all using (
    exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())
  );

create policy "own expenses" on public.expenses
  for all using (
    exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())
  );

create policy "own inbox documents" on public.inbox_documents
  for all using (
    exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())
  );

create policy "own storage connections" on public.storage_connections
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ============================================================
-- Account deletion support (App Store requirement).
-- Supabase's `auth.users` delete cascades through every table
-- above via `on delete cascade`, so deleting the auth user is
-- enough — expose this via a Postgres function callable from
-- Express with the service role key, or via Supabase's admin API.
-- ============================================================
-- Example (called server-side only, never from the client):
-- select auth.admin_delete_user('the-users-uuid');
