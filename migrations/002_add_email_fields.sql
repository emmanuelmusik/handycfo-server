-- ============================================================
-- 002_add_email_fields.sql
-- The prototype only ever collected a client's *name* — real
-- reminder emails need somewhere to send to. Run after 001 (the
-- main schema).
-- ============================================================

alter table public.contacts
  add column if not exists email text;

alter table public.invoices
  add column if not exists client_email text; -- for one-off clients with no saved contact

comment on column public.invoices.client_email is
  'Falls back to contacts.email via client_contact_id when set; this covers invoices billed to a client who is not (yet) a saved contact.';
