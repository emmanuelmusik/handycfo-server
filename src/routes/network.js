import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { getOwnedContact, getOwnedInvoice, route, httpError } from '../lib/ownership.js';
import { enforceLimit } from '../lib/rateLimit.js';
import { sendInvoiceEmail } from '../lib/email.js';

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
      owner_id: req.userId, name, relationship, email,
      on_platform: !!linkedUserId, linked_user_id: linkedUserId,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    })
    .select('*').single();
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
  const inv = await getOwnedInvoice(req.userId, req.params.id);
  if (inv.status === 'Paid') throw httpError(409, 'This invoice is already paid.');

  if (inv.status === 'Draft') {
    await supabaseAdmin.from('invoices').update({ status: 'Sent' }).eq('id', inv.id);
  }

  // Email the invoice to the saved address, once.
  let emailed = false;
  let emailError = null;
  let contact = null;
  if (inv.client_contact_id) contact = await getOwnedContact(req.userId, inv.client_contact_id);
  const recipientEmail = inv.client_email || contact?.email || null;
  if (!recipientEmail) {
    emailError = 'No email address saved for this client.';
  } else if (inv.sent_at) {
    emailed = true; // already emailed earlier
  } else {
    try {
      enforceLimit(`invoice-mail:${req.userId}`, 40, 60 * 60 * 1000);
      const { data: me } = await supabaseAdmin.auth.admin.getUserById(req.userId);
      await sendInvoiceEmail({
        invoice: inv, businessName: inv.businesses.name,
        recipientEmail, replyTo: me?.user?.email,
      });
      await supabaseAdmin.from('invoices').update({ sent_at: new Date().toISOString() }).eq('id', inv.id);
      emailed = true;
    } catch (err) {
      console.error('invoice email failed:', err.message);
      emailError = 'The invoice was marked as sent, but the email could not be delivered.';
    }
  }

  let deliveredInApp = false;
  if (contact) {
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
          file_name: `Invoice from ${inv.businesses.name}`,
          state: 'ready',
          extracted_merchant: inv.businesses.name,
          extracted_date: inv.issue_date,
          extracted_amount: inv.amount,
          extracted_vat: null,
          extracted_category: 'Other',
          extracted_currency: inv.currency,
          extracted_confidence: 'high',
          extracted_notes: `Sent to you on HandyCFO. Due ${inv.due_date}.`,
          source_invoice_id: inv.id,
        });
        // Already delivered earlier (unique index) is fine.
        if (!error || error.code === '23505') deliveredInApp = true;
        else throw new Error(error.message);
      }
    }
  }
  res.json({ sent: true, deliveredInApp, emailed, emailError, emailedTo: emailed ? recipientEmail : null });
}));
