import { Router } from 'express';
import { consume, refund } from '../lib/plans.js';
import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { getOwnedContact, getOwnedInvoice, getOwnedBusiness, route, httpError } from '../lib/ownership.js';
import { enforceLimit } from '../lib/rateLimit.js';
import { sendInvoiceEmail } from '../lib/email.js';
import { renderInvoicePdf, invoiceNumber } from '../lib/invoicePdf.js';
import { COUNTRIES } from '../lib/countries.js';
import { LANGS } from '../lib/invoiceI18n.js';
import { computeInvoice } from '../lib/invoiceMath.js';
import { sellerSnapshot, chooseMode, checkInvoice } from '../lib/invoiceRules.js';
import { loadItems, toCalcItems, sellerFor, allocateInvoiceNumber } from '../lib/invoiceService.js';

export const networkRouter = Router();
networkRouter.use(requireAuth);

const COLORS = ['#4f46e5', '#0d9488', '#d97706', '#db2777', '#2563eb', '#7c3aed', '#059669'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function findUserIdByEmail(email) {
  if (!email) return null;
  const { data, error } = await supabaseAdmin.rpc('find_user_id_by_email', { p_email: email });
  if (error) { console.warn('find_user_id_by_email failed:', error.message); return null; }
  return data || null;
}

async function displayNameFor(userId, fallbackEmail) {
  const { data } = await supabaseAdmin.from('profiles').select('full_name').eq('id', userId).maybeSingle();
  return data?.full_name || fallbackEmail || 'HandyCFO user';
}

// The other side of a conversation is a contact row owned by the other
// user that points back at me. Find it, or create it the first time.
async function reciprocalContact(me, linkedUserId, myRelationship) {
  const { data: existing } = await supabaseAdmin
    .from('contacts').select('*')
    .eq('owner_id', linkedUserId).eq('linked_user_id', me.id).maybeSingle();
  if (existing) return existing;

  const name = await displayNameFor(me.id, me.email);
  const { data, error } = await supabaseAdmin
    .from('contacts')
    .insert({
      owner_id: linkedUserId,
      name,
      email: me.email,
      relationship: myRelationship === 'Supplier' ? 'Client' : 'Supplier',
      on_platform: true,
      linked_user_id: me.id,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    })
    .select('*').single();
  if (error) throw new Error(error.message);
  return data;
}

const COUNTRY_CODES = new Set(COUNTRIES.map(([c]) => c));
const clip = (v, max) => { const t = String(v ?? '').trim().slice(0, max); return t || null; };

// Address, tax id and invoice language of a customer or supplier.
function contactDetails(body) {
  const b = body || {};
  return {
    street: clip(b.street, 120),
    postal_code: clip(b.postalCode, 20),
    city: clip(b.city, 80),
    region: clip(b.region, 60),
    country: COUNTRY_CODES.has(b.country) ? b.country : null,
    tax_id: clip(b.taxId, 40),
    language: LANGS.includes(b.language) ? b.language : null,
  };
}

networkRouter.post('/contacts', route(async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 100);
  const relationship = req.body?.relationship === 'Client' ? 'Client' : 'Supplier';
  const email = String(req.body?.email || '').trim().toLowerCase() || null;
  if (!name) throw httpError(400, 'Name is required.');
  if (email && !EMAIL_RE.test(email)) throw httpError(400, 'That email address does not look right.');
  enforceLimit(`contact:${req.userId}`, 60, 60 * 60 * 1000);

  let linkedUserId = await findUserIdByEmail(email);
  if (linkedUserId === req.userId) { linkedUserId = null; throw httpError(400, 'That is your own email address.'); }

  const { data, error } = await supabaseAdmin
    .from('contacts')
    .insert({
      owner_id: req.userId, name, relationship, email, ...contactDetails(req.body),
      on_platform: !!linkedUserId, linked_user_id: linkedUserId,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    })
    .select('*').single();
  if (error) throw new Error(error.message);
  res.json({ contact: data });
}));

// Change a contact's name, email, address and tax details.
networkRouter.put('/contacts/:id', route(async (req, res) => {
  const c = await getOwnedContact(req.userId, req.params.id);
  const name = String(req.body?.name || '').trim().slice(0, 100);
  const email = String(req.body?.email || '').trim().toLowerCase() || null;
  if (!name) throw httpError(400, 'Name is required.');
  if (email && !EMAIL_RE.test(email)) throw httpError(400, 'That email address does not look right.');
  const patch = { name, email, ...contactDetails(req.body) };
  if (email !== c.email) {
    const uid = await findUserIdByEmail(email);
    if (uid === req.userId) throw httpError(400, 'That is your own email address.');
    patch.linked_user_id = uid;
    patch.on_platform = !!uid;
  }
  const { data, error } = await supabaseAdmin.from('contacts').update(patch).eq('id', c.id).select('*').single();
  if (error) throw new Error(error.message);
  res.json({ contact: data });
}));

// People added before they signed up become connected once they do.
networkRouter.post('/network/refresh', route(async (req, res) => {
  const { data: pending } = await supabaseAdmin
    .from('contacts').select('id, email')
    .eq('owner_id', req.userId).eq('on_platform', false).not('email', 'is', null).limit(50);
  let linked = 0;
  for (const c of pending || []) {
    const uid = await findUserIdByEmail(c.email);
    if (uid && uid !== req.userId) {
      await supabaseAdmin.from('contacts').update({ on_platform: true, linked_user_id: uid }).eq('id', c.id);
      linked += 1;
    }
  }
  res.json({ linked });
}));

networkRouter.delete('/contacts/:id', route(async (req, res) => {
  const c = await getOwnedContact(req.userId, req.params.id);
  // Keep invoices/expenses that mention this contact; just detach.
  await supabaseAdmin.from('invoices').update({ client_contact_id: null }).eq('client_contact_id', c.id);
  await supabaseAdmin.from('expenses').update({ supplier_contact_id: null }).eq('supplier_contact_id', c.id);
  await supabaseAdmin.from('inbox_documents').update({ contact_id: null }).eq('contact_id', c.id);
  await supabaseAdmin.from('contacts').delete().eq('id', c.id);
  res.json({ deleted: true });
}));

networkRouter.post('/messages', route(async (req, res) => {
  const contact = await getOwnedContact(req.userId, req.body?.contactId);
  const body = String(req.body?.body || '').trim();
  if (!body) throw httpError(400, 'Write a message first.');
  if (body.length > 2000) throw httpError(400, 'That message is too long.');
  enforceLimit(`msg:${req.userId}`, 120, 60 * 60 * 1000);

  const { data: mine, error } = await supabaseAdmin
    .from('messages').insert({ contact_id: contact.id, sender: 'me', body, read_at: new Date().toISOString() })
    .select('*').single();
  if (error) throw new Error(error.message);

  let delivered = false;
  if (contact.linked_user_id) {
    const { data: me } = await supabaseAdmin.auth.admin.getUserById(req.userId);
    const theirContact = await reciprocalContact({ id: req.userId, email: me?.user?.email }, contact.linked_user_id, contact.relationship);
    await supabaseAdmin.from('messages').insert({ contact_id: theirContact.id, sender: 'them', body });
    delivered = true;
  }
  res.json({ message: mine, delivered });
}));

// Send an invoice. Marks it Sent; if the client uses HandyCFO it
// also lands in their Financial Inbox, ready to review and record.
networkRouter.post('/invoices/:id/send', route(async (req, res) => {
  let inv = await getOwnedInvoice(req.userId, req.params.id);
  if (inv.status === 'Paid') throw httpError(409, 'This invoice is already paid.');
  const business = await getOwnedBusiness(req.userId, inv.business_id);
  const itemRows = await loadItems(inv.id);

  // The sender chooses where it goes. With no choice given, use both (as before).
  const channels = req.body?.channels;
  const wantEmail = Array.isArray(channels) ? channels.includes('email') : true;
  const wantApp = Array.isArray(channels) ? channels.includes('app') : true;

  if (inv.status === 'Draft') {
    // First send: make sure it is complete, give it its number, and freeze the seller details.
    const seller = sellerSnapshot(business);
    const taxEnabled = business.tax_mode === 'vat' || business.tax_mode === 'sales_tax';
    const calc = computeInvoice(toCalcItems(itemRows), { includeTax: inv.prices_include_tax, taxEnabled });
    const mode = chooseMode({ seller, grossCents: calc.grossCents, currency: inv.currency, clientCountry: inv.client_country, requested: inv.invoice_mode === 'full' ? 'full' : 'auto' });
    const { missing, warnings } = checkInvoice({ seller, invoice: inv, items: toCalcItems(itemRows), mode, grossCents: calc.grossCents });
    if (missing.length) {
      throw httpError(422, 'This invoice is not ready to send yet.', { code: 'missing', missing, warnings });
    }
    // Sending an invoice for the first time uses one of this month's invoices on the Free plan.
    await consume(req.userId, 'invoices');
    let number;
    try {
      number = inv.invoice_number || await allocateInvoiceNumber(business, inv.issue_date);
    } catch (err) {
      await refund(req.userId, 'invoices');
      throw err;
    }
    const { data: updated, error: upErr } = await supabaseAdmin
      .from('invoices')
      .update({
        status: 'Sent', invoice_number: number, payment_reference: inv.payment_reference || number,
        seller_snapshot: seller, tax_mode: business.tax_mode, invoice_mode: mode,
      })
      .eq('id', inv.id).select('*').single();
    if (upErr) {
      await refund(req.userId, 'invoices');
      throw new Error(upErr.message);
    }
    inv = { ...inv, ...updated };
  }
  const seller = sellerFor(inv, business);

  // Email the invoice to the saved address, once.
  let emailed = false;
  let emailError = null;
  let contact = null;
  if (inv.client_contact_id) contact = await getOwnedContact(req.userId, inv.client_contact_id);
  const recipientEmail = inv.client_email || contact?.email || null;
  if (!wantEmail) {
    // not requested
  } else if (!recipientEmail) {
    emailError = 'No email address saved for this client.';
  } else if (inv.sent_at) {
    emailed = true; // already emailed earlier
  } else {
    try {
      enforceLimit(`invoice-mail:${req.userId}`, 40, 60 * 60 * 1000);
      const { data: me } = await supabaseAdmin.auth.admin.getUserById(req.userId);
      const pdf = await renderInvoicePdf({ invoice: inv, items: toCalcItems(itemRows), seller });
      await sendInvoiceEmail({
        invoice: inv, businessName: seller.legal_name || seller.name,
        recipientEmail, replyTo: seller.contact_email || me?.user?.email, pdf,
      });
      await supabaseAdmin.from('invoices').update({ sent_at: new Date().toISOString() }).eq('id', inv.id);
      emailed = true;
    } catch (err) {
      console.error('invoice email failed:', err.message);
      emailError = 'The invoice was marked as sent, but the email could not be delivered.';
    }
  }

  let deliveredInApp = false;
  if (wantApp && contact) {
    if (contact.linked_user_id) {
      const { data: theirBiz } = await supabaseAdmin
        .from('businesses').select('id')
        .eq('owner_id', contact.linked_user_id).order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (theirBiz) {
        const { data: me } = await supabaseAdmin.auth.admin.getUserById(req.userId);
        const theirContact = await reciprocalContact({ id: req.userId, email: me?.user?.email }, contact.linked_user_id, contact.relationship);
        const { error } = await supabaseAdmin.from('inbox_documents').insert({
          business_id: theirBiz.id,
          source: 'supplier',
          contact_id: theirContact.id,
          file_name: `Invoice ${invoiceNumber(inv)} from ${business.name}`,
          state: 'ready',
          extracted_merchant: seller.legal_name || business.name,
          extracted_date: inv.issue_date,
          extracted_amount: inv.amount,
          extracted_vat: Number(inv.vat_amount) > 0 ? inv.vat_amount : null,
          extracted_category: 'Other',
          extracted_currency: inv.currency,
          extracted_confidence: 'high',
          extracted_notes: `Sent to you on HandyCFO. Invoice ${invoiceNumber(inv)}, due ${inv.due_date}.`,
          source_invoice_id: inv.id,
        });
        // Already delivered earlier (unique index) is fine.
        if (!error || error.code === '23505') deliveredInApp = true;
        else throw new Error(error.message);
      }
    }
  }
  const appError = wantApp && !deliveredInApp
    ? (contact?.linked_user_id ? 'They have no business set up yet, so it could not be delivered in the app.' : 'This client is not on HandyCFO.')
    : null;
  res.json({ sent: true, deliveredInApp, emailed, emailError, appError, emailedTo: emailed ? recipientEmail : null });
}));

// Download the invoice as a PDF (also what gets attached to the email).
networkRouter.get('/invoices/:id/pdf', route(async (req, res) => {
  let inv = await getOwnedInvoice(req.userId, req.params.id);
  const business = await getOwnedBusiness(req.userId, inv.business_id);
  // A paid invoice that was never sent still needs a proper number.
  if (inv.status !== 'Draft' && !inv.invoice_number) {
    const number = await allocateInvoiceNumber(business, inv.issue_date);
    const { data } = await supabaseAdmin.from('invoices').update({ invoice_number: number, payment_reference: inv.payment_reference || number }).eq('id', inv.id).select('*').single();
    inv = { ...inv, ...data };
  }
  const items = toCalcItems(await loadItems(inv.id));
  const pdf = await renderInvoicePdf({ invoice: inv, items, seller: sellerFor(inv, business) });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Invoice-${inv.invoice_number || 'draft'}.pdf"`);
  res.send(pdf);
}));
