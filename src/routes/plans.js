import { Router } from 'express';
import crypto from 'node:crypto';
import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { route, httpError } from '../lib/ownership.js';
import { getPlan, getUsage, plansEnforced } from '../lib/plans.js';

export const plansRouter = Router();

// The signed-in person's plan, limits and what they have used this month.
plansRouter.get('/plan', requireAuth, route(async (req, res) => {
  const [info, usage, enforced] = await Promise.all([getPlan(req.userId), getUsage(req.userId), plansEnforced()]);
  res.json({ enforced, ...info, usage });
}));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GRANTING = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'NON_RENEWING_PURCHASE', 'TEMPORARY_ENTITLEMENT_GRANT']);

const planFromProduct = (id) => {
  const s = String(id || '').toLowerCase();
  if (s.includes('quarter')) return 'quarterly';
  if (s.includes('month')) return 'monthly';
  return null;
};

function secretOk(header) {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret) return false;
  const given = String(header || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Asks RevenueCat directly what the signed-in person has bought, so a late or missed webhook can never
// leave a paying customer on Free. Only ever asks about the caller's own id.
plansRouter.post('/plan/sync', requireAuth, route(async (req, res) => {
  const key = process.env.REVENUECAT_PUBLIC_KEY;
  if (!key) throw httpError(503, 'Store sync is not set up yet');
  const r = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(req.userId)}`, {
    headers: { Authorization: `Bearer ${key}`, 'X-Platform': 'ios', Accept: 'application/json' },
  });
  if (!r.ok) throw httpError(502, `Store lookup failed (${r.status})`);
  const subs = (await r.json())?.subscriber?.subscriptions || {};
  const now = Date.now();
  let best = null;
  for (const [productId, sub] of Object.entries(subs)) {
    const exp = sub?.expires_date ? Date.parse(sub.expires_date) : null;
    const plan = planFromProduct(productId);
    if (!plan || !exp || exp <= now) continue;
    if (!best || exp > best.exp) best = { plan, exp, trial: sub.period_type === 'trial' };
  }
  if (best) {
    const { error } = await supabaseAdmin.from('subscriptions').upsert(
      { user_id: req.userId, provider: 'revenuecat', plan: best.plan, status: 'active', is_trial: best.trial, current_period_end: new Date(best.exp).toISOString(), updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
    if (error) throw new Error(error.message);
  }
  res.json({ synced: !!best, plan: best?.plan || null });
}));

// RevenueCat tells us when someone subscribes, renews, cancels or lets it lapse.
// In RevenueCat: set the app user id to the person's HandyCFO user id, and add this URL as a
// webhook with the Authorization header "Bearer <REVENUECAT_WEBHOOK_SECRET>".
plansRouter.post('/webhooks/revenuecat', route(async (req, res) => {
  if (!secretOk(req.headers.authorization)) {
    // Safe diagnostics only (no secret values): helps spot a missing or mistyped header in RevenueCat.
    const h = String(req.headers.authorization || '');
    console.warn(`RevenueCat webhook refused: header ${h ? `present, ${h.length} chars, starts with "${h.slice(0, 7)}"` : 'missing'}; server secret ${process.env.REVENUECAT_WEBHOOK_SECRET ? `set, ${process.env.REVENUECAT_WEBHOOK_SECRET.length} chars` : 'NOT SET'}`);
    throw httpError(401, 'Unauthorized');
  }
  const ev = req.body?.event || {};
  const userId = ev.app_user_id;
  if (!UUID_RE.test(String(userId || ''))) return res.json({ ignored: 'not a HandyCFO user id' });

  const end = ev.expiration_at_ms ? new Date(Number(ev.expiration_at_ms)).toISOString() : null;
  let row = null;
  if (GRANTING.has(ev.type)) {
    const plan = planFromProduct(ev.product_id);
    if (!plan) return res.json({ ignored: `unknown product ${ev.product_id}` });
    row = { plan, status: 'active', is_trial: ev.period_type === 'TRIAL', current_period_end: end };
  } else if (ev.type === 'CANCELLATION') {
    // Still paid until the period ends; just note that it will not renew.
    row = { status: 'cancelled' };
  } else if (ev.type === 'EXPIRATION') {
    row = { plan: 'free', status: 'expired', is_trial: false, current_period_end: end };
  } else {
    return res.json({ ignored: ev.type || 'no event' });
  }

  const { error } = await supabaseAdmin.from('subscriptions').upsert(
    { user_id: userId, provider: 'revenuecat', provider_ref: ev.original_app_user_id || null, updated_at: new Date().toISOString(), ...row },
    { onConflict: 'user_id' }
  );
  if (error) throw new Error(error.message);
  res.json({ ok: true });
}));
