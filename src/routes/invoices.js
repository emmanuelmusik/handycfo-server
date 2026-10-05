import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { getOwnedBusiness, getOwnedInvoice, route, httpError } from '../lib/ownership.js';
import { COUNTRIES } from '../lib/countries.js';
import { LANGS } from '../lib/invoiceI18n.js';
import { computeInvoice, fromCents } from '../lib/invoiceMath.js';
import { sellerSnapshot, chooseMode, checkInvoice } from '../lib/invoiceRules.js';
import { loadItems, toCalcItems } from '../lib/invoiceService.js';

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth);

const COUNTRY_CODES = new Set(COUNTRIES.map(([c]) => c));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCIES = ['EUR', 'USD', 'GBP'];

const str = (v, max) => {
  const s = String(v ?? '').trim().slice(0, max);
  return s || null;
};
const isDate = (v) => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

// Validates what the app sent and works out every number on the server,
// so totals can never be wrong or tampered with.
function parseInvoice(body, business) {
  const b = body || {};
  const clientName = str(b.clientName, 120);
  if (!clientName) throw httpError(400, 'Add the customer name.');
  const clientEmail = str(b.clientEmail, 200);
  if (clientEmail && !EMAIL_RE.test(clientEmail)) throw httpError(400, 'The customer email address does not look right.');
  if (!isDate(b.issueDate)) throw httpError(400, 'Enter a valid invoice date.');
  if (!isDate(b.dueDate)) throw httpError(400, 'Enter a valid due date.');
  if (b.dueDate < b.issueDate) throw httpError(400, 'The due date can not be before the invoice date.');
  if (b.serviceDate && !isDate(b.serviceDate)) throw httpError(400, 'Enter a valid service date.');
  if (b.serviceEndDate && !isDate(b.serviceEndDate)) throw httpError(400, 'Enter a valid end date for the service period.');
  if (b.serviceDate && b.serviceEndDate && b.serviceEndDate < b.serviceDate) throw httpError(400, 'The service period ends before it starts.');

  const rawItems = Array.isArray(b.items) ? b.items : [];
  if (rawItems.length < 1) throw httpError(400, 'Add at least one line to the invoice.');
  if (rawItems.length > 50) throw httpError(400, 'An invoice can have at most 50 lines.');

  const taxEnabled = business.tax_mode === 'vat' || business.tax_mode === 'sales_tax';
  const items = rawItems.map((it, i) => {
    const description = str(it?.description, 300);
    const quantity = Number(it?.quantity);
    const unitPrice = Number(it?.unitPrice);
    const taxRate = taxEnabled ? Number(it?.taxRate || 0) : 0;
    if (!description) throw httpError(400, `Line ${i + 1} needs a description.`);
    if (!(quantity > 0) || quantity > 1_000_000) throw httpError(400, `Line ${i + 1}: enter a quantity above zero.`);
    if (!(unitPrice >= 0) || unitPrice > 1_000_000_000) throw httpError(400, `Line ${i + 1}: enter a valid price.`);
    if (!(taxRate >= 0 && taxRate <= 100)) throw httpError(400, `Line ${i + 1}: the tax rate must be between 0 and 100.`);
    return { description, quantity, unitPrice, taxRate };
  });

  const currency = CURRENCIES.includes(b.currency) ? b.currency : business.currency;
  const pricesIncludeTax = taxEnabled && !!b.pricesIncludeTax;
  const calc = computeInvoice(items, { includeTax: pricesIncludeTax, taxEnabled });
  const clientCountry = COUNTRY_CODES.has(b.clientCountry) ? b.clientCountry : null;

  const fields = {
    client_contact_id: b.contactId || null,
    client_name: clientName,
    client_email: clientEmail,
    client_street: str(b.clientStreet, 120),
    client_postal_code: str(b.clientPostalCode, 20),
    client_city: str(b.clientCity, 80),
    client_region: str(b.clientRegion, 60),
    client_country: clientCountry,
    client_tax_id: str(b.clientTaxId, 40),
    issue_date: b.issueDate,
    due_date: b.dueDate,
    service_date: b.serviceDate || null,
    service_end_date: b.serviceEndDate && b.serviceEndDate !== b.serviceDate ? b.serviceEndDate : null,
    currency,
    language: LANGS.includes(b.language) ? b.language : (business.invoice_language || 'en'),
    notes: str(b.notes, 1000),
    prices_include_tax: pricesIncludeTax,
    tax_mode: business.tax_mode,
    amount: fromCents(calc.grossCents),
    net_amount: fromCents(calc.netCents),
    vat_amount: fromCents(calc.vatCents),
  };
  return { fields, items, calc, requestedMode: b.mode === 'full' ? 'full' : 'auto' };
}

async function checkAndMode(business, fields, items, calc, requestedMode, existingSnapshot) {
  const seller = existingSnapshot || sellerSnapshot(business);
  const mode = chooseMode({ seller, grossCents: calc.grossCents, currency: fields.currency, clientCountry: fields.client_country, requested: requestedMode });
  const result = checkInvoice({ seller, invoice: fields, items, mode, grossCents: calc.grossCents });
  return { mode, ...result };
}

async function saveItems(invoiceId, items) {
  await supabaseAdmin.from('invoice_items').delete().eq('invoice_id', invoiceId);
  const rows = items.map((it, i) => ({
    invoice_id: invoiceId, position: i, description: it.description,
    quantity: it.quantity, unit_price: it.unitPrice, tax_rate: it.taxRate,
  }));
  const { error } = await supabaseAdmin.from('invoice_items').insert(rows);
  if (error) throw new Error(`Could not save the invoice lines: ${error.message}`);
}

// Create an invoice. It is always saved as a draft; sending gives it its number.
invoicesRouter.post('/invoices', route(async (req, res) => {
  const business = await getOwnedBusiness(req.userId, req.body?.businessId);
  const { fields, items, calc, requestedMode } = parseInvoice(req.body, business);

  if (fields.client_contact_id) {
    const { data: c } = await supabaseAdmin.from('contacts').select('id').eq('id', fields.client_contact_id).eq('owner_id', req.userId).maybeSingle();
    if (!c) throw httpError(404, 'Contact not found');
  }

  const check = await checkAndMode(business, fields, items, calc, requestedMode, null);
  const { data: invoice, error } = await supabaseAdmin
    .from('invoices')
    .insert({ ...fields, business_id: business.id, status: 'Draft', invoice_mode: check.mode })
    .select('*').single();
  if (error) throw new Error(error.message);
  try {
    await saveItems(invoice.id, items);
  } catch (err) {
    await supabaseAdmin.from('invoices').delete().eq('id', invoice.id);
    throw err;
  }
  res.json({ invoice, mode: check.mode, missing: check.missing, warnings: check.warnings });
}));

// Edit a draft. Sent invoices are never changed (they are legal documents).
invoicesRouter.put('/invoices/:id', route(async (req, res) => {
  const inv = await getOwnedInvoice(req.userId, req.params.id);
  if (inv.status !== 'Draft') throw httpError(409, 'An invoice that has been sent can not be edited.');
  const business = await getOwnedBusiness(req.userId, inv.business_id);
  const { fields, items, calc, requestedMode } = parseInvoice(req.body, business);

  if (fields.client_contact_id) {
    const { data: c } = await supabaseAdmin.from('contacts').select('id').eq('id', fields.client_contact_id).eq('owner_id', req.userId).maybeSingle();
    if (!c) throw httpError(404, 'Contact not found');
  }

  const check = await checkAndMode(business, fields, items, calc, requestedMode, null);
  const { data: invoice, error } = await supabaseAdmin
    .from('invoices').update({ ...fields, invoice_mode: check.mode }).eq('id', inv.id).select('*').single();
  if (error) throw new Error(error.message);
  await saveItems(inv.id, items);
  res.json({ invoice, mode: check.mode, missing: check.missing, warnings: check.warnings });
}));

// What is still missing on a draft, without changing anything.
invoicesRouter.get('/invoices/:id/check', route(async (req, res) => {
  const inv = await getOwnedInvoice(req.userId, req.params.id);
  const business = await getOwnedBusiness(req.userId, inv.business_id);
  const items = toCalcItems(await loadItems(inv.id));
  const taxEnabled = business.tax_mode === 'vat' || business.tax_mode === 'sales_tax';
  const calc = computeInvoice(items, { includeTax: inv.prices_include_tax, taxEnabled });
  const check = await checkAndMode(business, inv, items, calc, inv.invoice_mode === 'full' ? 'full' : 'auto', inv.seller_snapshot);
  res.json({ mode: check.mode, missing: check.missing, warnings: check.warnings });
}));
