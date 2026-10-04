-- 004_invoice_sent_at.sql
-- Remembers when an invoice was emailed, so it is never emailed twice.
-- Run in the Supabase SQL editor. Safe to run more than once.
alter table public.invoices add column if not exists sent_at timestamptz;
