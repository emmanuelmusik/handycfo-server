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

// RevenueCat tells us when someone subscribes, renews, cancels or lets it lapse.
// In RevenueCat: set the app user id to the person's HandyCFO user id, and add this URL as a
// webhook with the Authorization header "Bearer <REVENUECAT_WEBHOOK_SECRET>".
plansRouter.post('/webhooks/revenuecat', route(async (req, res) => {
  if (!secretOk(req.headers.authorization)) throw httpError(401, 'Unauthorized');
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
