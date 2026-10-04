-- ============================================================
-- 003_receipts_network_account.sql
-- Run in the Supabase SQL editor AFTER 001 and 002.
-- Safe to run more than once.
-- ============================================================

-- 1) Receipts can now also live in a private Supabase Storage bucket
--    (used when the user has not connected Dropbox).
alter type receipt_provider add value if not exists 'supabase';

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;
-- No storage policies are added on purpose: with RLS on and no policy,
-- only the server (service role) can touch this bucket. The app only
-- ever sees short-lived signed links the server creates.

-- 2) Extra facts about a scan, so the review screen can show them.
alter table public.inbox_documents
  add column if not exists extracted_currency text,
  add column if not exists extracted_confidence text,
  add column if not exists extracted_notes text,
  add column if not exists source_invoice_id uuid references public.invoices(id) on delete set null;

-- One supplier invoice can land in a recipient's inbox only once.
create unique index if not exists inbox_one_per_invoice
  on public.inbox_documents(source_invoice_id, business_id)
  where source_invoice_id is not null;

-- 3) Deleting a user must not be blocked because other people have
--    them saved as a linked contact. Those links just become empty.
alter table public.contacts
  drop constraint if exists contacts_linked_user_id_fkey;
alter table public.contacts
  add constraint contacts_linked_user_id_fkey
  foreign key (linked_user_id) references auth.users(id) on delete set null;

create index if not exists contacts_linked_idx on public.contacts(linked_user_id);

-- 4) Lookup used by the server to find out whether a contact's email
--    belongs to someone who already uses HandyCFO. Only the server
--    (service role) may call it.
create or replace function public.find_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function public.find_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.find_user_id_by_email(text) to service_role;

-- 5) Unread counts for the sidebar badge are read straight from messages
--    (sender = 'them' and read_at is null), so a small index helps.
create index if not exists messages_unread_idx
  on public.messages(contact_id) where read_at is null and sender = 'them';
