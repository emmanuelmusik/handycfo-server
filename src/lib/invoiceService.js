import { supabaseAdmin } from './supabaseAdmin.js';
import { sellerSnapshot } from './invoiceRules.js';

// Small helpers shared by the invoice routes.

export async function loadItems(invoiceId) {
  const { data, error } = await supabaseAdmin
    .from('invoice_items').select('*').eq('invoice_id', invoiceId).order('position', { ascending: true });
  if (error) throw new Error(`Could not load the invoice lines: ${error.message}`);
  return data || [];
}

// DB rows -> the shape the maths and the PDF use.
export const toCalcItems = (rows) => (rows || []).map((r) => ({
  description: r.description,
  quantity: Number(r.quantity),
  unitPrice: Number(r.unit_price),
  taxRate: Number(r.tax_rate),
}));

// Once an invoice has been sent its seller details are frozen; before that they follow the profile.
export const sellerFor = (invoice, business) => invoice.seller_snapshot || sellerSnapshot(business);

const cleanPrefix = (p) => String(p || 'INV').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 10) || 'INV';

// Next number such as SC-2026-001, never repeated, never skipped.
export async function allocateInvoiceNumber(business, issueDate) {
  const year = Number(String(issueDate || '').slice(0, 4)) || new Date().getFullYear();
  const { data, error } = await supabaseAdmin.rpc('allocate_invoice_number', {
    p_business: business.id, p_year: year, p_start: business.invoice_start_number || 1,
  });
  if (error) throw new Error(`Could not number the invoice: ${error.message}`);
  return `${cleanPrefix(business.invoice_prefix)}-${year}-${String(data).padStart(3, '0')}`;
}
