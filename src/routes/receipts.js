import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { getOwnedBusiness, getOwnedInboxDoc, getOwnedExpense, route, httpError } from '../lib/ownership.js';
import { parseReceipts } from '../lib/receiptParser.js';
import { saveReceipt, getReceiptUrl, removeReceipt, isFileInUse } from '../lib/storage.js';
import { enforceLimit } from '../lib/rateLimit.js';
import { findDuplicate, sameReceipt, describeDuplicate } from '../lib/duplicates.js';

export const receiptsRouter = Router();
receiptsRouter.use(requireAuth);

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PAGES = 8;

// Scan a file: read every receipt in it, store the file once, and create
// one inbox item per receipt. A photo or PDF may hold one receipt or several.
receiptsRouter.post('/receipts/scan', route(async (req, res) => {
  const { businessId, fileName, mediaType, data, readImages } = req.body || {};
  const business = await getOwnedBusiness(req.userId, businessId);

  if (!ALLOWED_TYPES.includes(mediaType)) throw httpError(400, 'Please upload a photo (JPG, PNG, WebP) or a PDF.');
  if (typeof data !== 'string' || !data.length) throw httpError(400, 'No file received.');
  const buffer = Buffer.from(data, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_BYTES) throw httpError(413, 'That file is too large. Please keep it under 8 MB.');

  // Pictures for readers that cannot take PDFs: one per page.
  let images;
  if (mediaType === 'application/pdf') {
    if (!Array.isArray(readImages) || readImages.length === 0) {
      throw httpError(400, 'Please update the app so PDFs can be read.');
    }
    images = readImages.slice(0, MAX_PAGES).map((img) => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(img?.mediaType) || typeof img?.data !== 'string') {
        throw httpError(400, 'A page image sent with the PDF is not valid.');
      }
      const buf = Buffer.from(img.data, 'base64');
      if (buf.length === 0 || buf.length > 4 * 1024 * 1024) throw httpError(413, 'A PDF page is too large to read.');
      return { buffer: buf, mediaType: img.mediaType };
    });
  } else {
    images = [{ buffer, mediaType }];
  }

  enforceLimit(`scan:${req.userId}`, 30, 60 * 60 * 1000);

  let parsed;
  try {
    parsed = await parseReceipts({ buffer, mediaType }, images);
  } catch (err) {
    if (err.status) throw err;
    console.error('receipt parse failed:', err);
    throw httpError(502, 'We could not read that document. Please try a clearer photo.');
  }
  if (parsed.length === 0) throw httpError(422, 'That does not look like a receipt or invoice.');

  const stored = await saveReceipt({ userId: req.userId, business, fileName, buffer, mediaType });

  // Flag receipts we already have: in the books, waiting in the inbox, or
  // repeated inside this very file (e.g. two overlapping photos of one receipt).
  const dupNotes = [];
  for (let i = 0; i < parsed.length; i += 1) {
    const p = parsed[i];
    const cand = { merchant: p.merchant, date: p.date, amount: p.amount, currency: p.currency };
    const earlier = parsed.slice(0, i).findIndex((q) => sameReceipt(cand, { merchant: q.merchant, date: q.date, amount: q.amount, currency: q.currency }));
    if (earlier >= 0) {
      dupNotes.push(`Possible duplicate of receipt ${earlier + 1} in this same file.`);
      continue;
    }
    const found = await findDuplicate(business.id, cand).catch(() => null);
    dupNotes.push(found ? describeDuplicate(found) : '');
  }

  const total = parsed.length;
  const baseName = String(fileName || 'receipt').slice(0, 100);
  const rows = parsed.map((p, i) => {
    const where = [total > 1 ? `Receipt ${i + 1} of ${total} in this file.` : '', p.page && (mediaType === 'application/pdf' || images.length > 1) ? `Page ${p.page}.` : '']
      .filter(Boolean).join(' ');
    const currencyNote = p.currencySupported ? '' : `Document currency was ${p.currency}; please check the amount.`;
    return {
      business_id: business.id,
      source: 'upload',
      file_name: total > 1 ? `${baseName} (${i + 1}/${total})` : baseName,
      state: 'ready',
      extracted_merchant: p.merchant || null,
      extracted_date: p.date,
      extracted_amount: p.amount,
      extracted_vat: p.vat,
      extracted_category: p.category,
      extracted_currency: p.currencySupported ? p.currency : business.currency,
      extracted_confidence: p.confidence,
      extracted_notes: [dupNotes[i], where, p.notes, currencyNote].filter(Boolean).join(' ') || null,
      receipt_provider: stored.provider,
      receipt_external_id: stored.externalId,
    };
  });

  const { data: docs, error } = await supabaseAdmin.from('inbox_documents').insert(rows).select('*');
  if (error) {
    await removeReceipt(req.userId, stored.provider, stored.externalId, { allowDropboxDelete: true });
    throw new Error(`Could not save the scan: ${error.message}`);
  }
  res.json({ documents: docs, document: docs[0] });
}));

// Short-lived link to view the original file of an inbox item.
receiptsRouter.get('/inbox/:id/file', route(async (req, res) => {
  const doc = await getOwnedInboxDoc(req.userId, req.params.id);
  const url = await getReceiptUrl(req.userId, doc.receipt_provider, doc.receipt_external_id);
  if (!url) throw httpError(404, 'No file stored for this document.');
  res.json({ url });
}));

// Turn a reviewed inbox item into a real expense.
receiptsRouter.post('/inbox/:id/confirm', route(async (req, res) => {
  const doc = await getOwnedInboxDoc(req.userId, req.params.id);
  if (doc.state === 'reviewed') throw httpError(409, 'This document was already recorded.');

  const b = req.body || {};
  const merchant = String(b.merchant || '').trim().slice(0, 120);
  const amount = Number(b.amount);
  const vat = b.vat === '' || b.vat == null ? 0 : Number(b.vat);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : null;
  const currency = ['EUR', 'USD', 'GBP'].includes(b.currency) ? b.currency : 'EUR';
  const category = String(b.category || 'Other').slice(0, 40);

  if (!merchant) throw httpError(400, 'Merchant is required.');
  if (!Number.isFinite(amount) || amount < 0) throw httpError(400, 'Enter a valid amount.');
  if (!Number.isFinite(vat) || vat < 0 || vat > amount) throw httpError(400, 'VAT cannot be higher than the total.');
  if (!date) throw httpError(400, 'Enter a valid date.');

  if (!b.allowDuplicate) {
    const dup = await findDuplicate(doc.business_id, { merchant, date, amount, currency }, { exceptInboxId: doc.id, includeInbox: false });
    if (dup) throw httpError(409, describeDuplicate(dup), { code: 'duplicate', duplicate: dup });
  }

  const { data: expense, error } = await supabaseAdmin
    .from('expenses')
    .insert({
      business_id: doc.business_id,
      supplier_contact_id: doc.contact_id || null,
      merchant, category, amount, vat_amount: vat, currency, expense_date: date,
      receipt_provider: doc.receipt_provider,
      receipt_external_id: doc.receipt_external_id,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);

  await supabaseAdmin
    .from('inbox_documents')
    .update({ state: 'reviewed', reviewed_at: new Date().toISOString(), resolved_expense_id: expense.id })
    .eq('id', doc.id);

  res.json({ expense });
}));

// Discard an inbox item. A file we stored for a scan is removed too;
// for supplier invoices there is no file.
receiptsRouter.delete('/inbox/:id', route(async (req, res) => {
  const doc = await getOwnedInboxDoc(req.userId, req.params.id);
  if (doc.state !== 'reviewed' && !(await isFileInUse(doc.receipt_external_id, { exceptInboxId: doc.id }))) {
    await removeReceipt(req.userId, doc.receipt_provider, doc.receipt_external_id, { allowDropboxDelete: true });
  }
  await supabaseAdmin.from('inbox_documents').delete().eq('id', doc.id);
  res.json({ deleted: true });
}));

// View the receipt of a recorded expense.
receiptsRouter.get('/expenses/:id/receipt', route(async (req, res) => {
  const exp = await getOwnedExpense(req.userId, req.params.id);
  const url = await getReceiptUrl(req.userId, exp.receipt_provider, exp.receipt_external_id);
  if (!url) throw httpError(404, 'No receipt stored for this expense.');
  res.json({ url });
}));

// Delete an expense; our own stored copy goes with it. A file in the
// user's Dropbox is theirs and is left alone.
receiptsRouter.delete('/expenses/:id', route(async (req, res) => {
  const exp = await getOwnedExpense(req.userId, req.params.id);
  await supabaseAdmin.from('expenses').delete().eq('id', exp.id);
  if (exp.receipt_provider === 'supabase' && !(await isFileInUse(exp.receipt_external_id, { exceptExpenseId: exp.id }))) {
    await removeReceipt(req.userId, 'supabase', exp.receipt_external_id);
  }
  res.json({ deleted: true });
}));
