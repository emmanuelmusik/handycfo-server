import 'dotenv/config';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { sendReminderEmail } from '../lib/email.js';
import { plansEnforced, isActivePaid } from '../lib/plans.js';

const LEVEL_RANK = { none: 0, '1st': 1, '2nd': 2, final: 3 };

function daysOverdue(dueDate) {
  const due = new Date(dueDate + 'T00:00:00Z');
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.floor((todayUtc - due.getTime()) / 86_400_000);
}

function targetLevelFor(overdueDays) {
  if (overdueDays >= 14) return 'final';
  if (overdueDays >= 7) return '2nd';
  if (overdueDays >= 0) return '1st';
  return 'none'; // not due yet
}

export async function runReminderJob() {
  const results = { statusUpdated: 0, remindersSent: 0, skippedNoEmail: 0, errors: 0 };

  const { data: invoices, error } = await supabaseAdmin
    .from('invoices')
    .select('id, invoice_number, business_id, client_contact_id, client_name, client_email, due_date, amount, currency, status, reminder_level, auto_reminders')
    .in('status', ['Sent', 'Overdue']);

  if (error) {
    console.error('Failed to load invoices for reminders:', error);
    results.errors++;
    return results;
  }

  // Automatic reminders are a paid feature. Work out who is on a paid plan once per run.
  const enforced = await plansEnforced();
  const paidOwners = new Set();
  const ownerOf = new Map();
  if (enforced) {
    const [{ data: subs }, { data: biz }] = await Promise.all([
      supabaseAdmin.from('subscriptions').select('user_id, plan, current_period_end'),
      supabaseAdmin.from('businesses').select('id, owner_id'),
    ]);
    for (const s of subs || []) if (isActivePaid(s)) paidOwners.add(s.user_id);
    for (const b of biz || []) ownerOf.set(b.id, b.owner_id);
  }

  for (const invoice of invoices) {
    const overdueDays = daysOverdue(invoice.due_date);

    // 1. Keep status honest regardless of the auto-reminders toggle.
    if (overdueDays >= 0 && invoice.status !== 'Overdue') {
      const { error: statusErr } = await supabaseAdmin
        .from('invoices')
        .update({ status: 'Overdue' })
        .eq('id', invoice.id);
      if (statusErr) {
        console.error(`Failed to mark invoice ${invoice.id} overdue:`, statusErr);
        results.errors++;
      } else {
        results.statusUpdated++;
      }
    }

    // 2. Reminders only for invoices that opted in, and only when
    //    the invoice has progressed to a new reminder level since
    //    we last checked — this is what stops it re-sending daily.
    if (!invoice.auto_reminders) continue;
    if (enforced && !paidOwners.has(ownerOf.get(invoice.business_id))) continue; // Free plan: no automatic reminders

    const targetLevel = targetLevelFor(overdueDays);
    if (LEVEL_RANK[targetLevel] <= LEVEL_RANK[invoice.reminder_level]) continue; // no progression, nothing to do

    const recipientEmail = invoice.client_email
      || (invoice.client_contact_id
        ? (await supabaseAdmin.from('contacts').select('email').eq('id', invoice.client_contact_id).single()).data?.email
        : null);

    if (!recipientEmail) {
      console.warn(`No email on file for invoice ${invoice.id} (${invoice.client_name}) — skipping reminder`);
      results.skippedNoEmail++;
      continue;
    }

    try {
      await sendReminderEmail({ ...invoice, reminder_level: targetLevel }, recipientEmail);
      await supabaseAdmin.from('invoices').update({ reminder_level: targetLevel }).eq('id', invoice.id);
      results.remindersSent++;
    } catch (err) {
      console.error(`Failed to send reminder for invoice ${invoice.id}:`, err);
      results.errors++;
    }
  }

  console.log('Reminder job finished:', results);
  return results;
}

// Allows `npm run reminders:run-now` for manual testing, separate
// from the in-process schedule wired up in src/index.js.
if (import.meta.url === `file://${process.argv[1]}`) {
  runReminderJob().then(() => process.exit(0));
}
