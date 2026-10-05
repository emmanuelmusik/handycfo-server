import { supabaseAdmin } from './supabaseAdmin.js';

// A duplicate is the same receipt entered twice: same business, same day,
// same amount, and a merchant name that is the same or clearly similar.
// We deliberately do NOT flag "same amount, different shop" (two 3.50 coffees
// on one day are normal), so warnings stay rare and believable.

const COMPANY_WORDS = /\b(gmbh|ges m b h|mbh|ag|kg|og|eu|ltd|limited|llc|inc|corp|co|sa|srl|bv|nv|plc|und|the|der|die|das)\b/g;

export function normMerchant(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(COMPANY_WORDS, ' ')
    .replace(/[^a-z0-9äöüß]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function sameMerchant(a, b) {
  const x = normMerchant(a);
  const y = normMerchant(b);
  if (!x || !y) return true; // nothing to contradict: rely on date + amount
  if (x === y) return true;
  const sx = x.replace(/ /g, '');
  const sy = y.replace(/ /g, '');
  if (Math.min(sx.length, sy.length) >= 4 && (sx.includes(sy) || sy.includes(sx))) return true;
  const fx = x.split(' ')[0];
  const fy = y.split(' ')[0];
  return fx.length >= 4 && fx === fy;
}

export function sameAmount(a, b) {
  return a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.005;
}

export function sameReceipt(a, b) {
  return !!a.date && a.date === b.date && sameAmount(a.amount, b.amount) && sameMerchant(a.merchant, b.merchant)
    && (!a.currency || !b.currency || a.currency === b.currency);
}

// Looks for an already recorded expense (and, optionally, another receipt
// waiting in the inbox) that matches. Returns the match or null.
export async function findDuplicate(businessId, candidate, { exceptInboxId = null, includeInbox = true } = {}) {
  if (!candidate.date || candidate.amount == null) return null;

  const { data: expenses } = await supabaseAdmin
    .from('expenses')
    .select('id, merchant, expense_date, amount, currency')
    .eq('business_id', businessId)
    .eq('expense_date', candidate.date);
  for (const e of expenses || []) {
    if (sameReceipt(candidate, { merchant: e.merchant, date: e.expense_date, amount: e.amount, currency: e.currency })) {
      return { kind: 'expense', id: e.id, merchant: e.merchant, date: e.expense_date, amount: Number(e.amount), currency: e.currency };
    }
  }

  if (includeInbox) {
    let q = supabaseAdmin
      .from('inbox_documents')
      .select('id, extracted_merchant, extracted_date, extracted_amount, extracted_currency')
      .eq('business_id', businessId)
      .eq('state', 'ready')
      .eq('extracted_date', candidate.date);
    if (exceptInboxId) q = q.neq('id', exceptInboxId);
    const { data: waiting } = await q;
    for (const d of waiting || []) {
      if (sameReceipt(candidate, { merchant: d.extracted_merchant, date: d.extracted_date, amount: d.extracted_amount, currency: d.extracted_currency })) {
        return { kind: 'inbox', id: d.id, merchant: d.extracted_merchant, date: d.extracted_date, amount: Number(d.extracted_amount), currency: d.extracted_currency };
      }
    }
  }
  return null;
}

export function describeDuplicate(d) {
  const where = d.kind === 'expense' ? 'already recorded as an expense' : 'already waiting in your inbox';
  return `Possible duplicate: ${d.merchant || 'a receipt'} for ${d.amount.toFixed(2)} ${d.currency || ''} on ${d.date} is ${where}.`.replace(/\s+/g, ' ');
}
