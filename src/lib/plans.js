import { supabaseAdmin } from './supabaseAdmin.js';
import { httpError } from './ownership.js';

// What each plan includes. Free is capped; Monthly and Quarterly are the same plan billed differently.
export const LIMITS = {
  free: { businesses: 1, invoices: 5, scans: 10 },
  paid: { businesses: 3, invoices: null, scans: 150 }, // null = unlimited
};

const KIND_LABEL = { scans: 'receipt scans', invoices: 'invoices' };

// Limits are switched on in the database (app_settings.plans_enforced), so
// they can be turned on at launch without a new deploy. Cached for a minute.
let enforcedCache = { at: 0, value: false };
export async function plansEnforced() {
  if (Date.now() - enforcedCache.at < 60_000) return enforcedCache.value;
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'plans_enforced').maybeSingle();
  enforcedCache = { at: Date.now(), value: data?.value === 'true' };
  return enforcedCache.value;
}

export function isActivePaid(sub, now = new Date()) {
  if (!sub || sub.plan === 'free') return false;
  return !sub.current_period_end || new Date(sub.current_period_end) > now;
}

export async function getPlan(userId) {
  const { data: sub } = await supabaseAdmin.from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
  const paid = isActivePaid(sub);
  return {
    plan: paid ? sub.plan : 'free',
    paid,
    isTrial: paid && !!sub.is_trial,
    periodEnd: paid ? sub.current_period_end : null,
    limits: paid ? LIMITS.paid : LIMITS.free,
  };
}

// First day of this month (UTC): allowances reset then.
export const currentPeriod = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;

// Takes one unit of a monthly allowance, or throws a 402 the app turns into the upgrade screen.
export async function consume(userId, kind) {
  const info = await getPlan(userId);
  const enforced = await plansEnforced();
  const limit = enforced ? info.limits[kind] : null;
  const { data, error } = await supabaseAdmin.rpc('consume_usage', { p_user: userId, p_kind: kind, p_period: currentPeriod(), p_limit: limit });
  if (error) throw new Error(`Could not check your plan: ${error.message}`);
  if (data === -1) {
    throw httpError(402, `You have used all ${limit} ${KIND_LABEL[kind] || kind} on the Free plan this month. Upgrade to continue.`, {
      code: 'plan_limit', kind, limit, plan: info.plan,
    });
  }
}

export async function refund(userId, kind) {
  await supabaseAdmin.rpc('refund_usage', { p_user: userId, p_kind: kind, p_period: currentPeriod() }).catch(() => {});
}

// For features that belong to the paid plans only.
export async function requirePaid(userId, feature) {
  if (!(await plansEnforced())) return;
  const info = await getPlan(userId);
  if (!info.paid) throw httpError(402, 'This feature is part of the paid plans.', { code: 'plan_feature', feature, plan: info.plan });
}

export async function getUsage(userId) {
  const { data } = await supabaseAdmin.from('usage_counters').select('kind, used').eq('user_id', userId).eq('period', currentPeriod());
  const used = Object.fromEntries((data || []).map((r) => [r.kind, r.used]));
  const { count } = await supabaseAdmin.from('businesses').select('id', { count: 'exact', head: true }).eq('owner_id', userId);
  return { scans: used.scans || 0, invoices: used.invoices || 0, businesses: count || 0 };
}
