import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

function money(amount, currency) {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(amount);
}

const TEMPLATES = {
  '1st': (inv) => ({
    subject: `Invoice ${inv.id.slice(0, 8)} — payment reminder`,
    html: `<p>Hi,</p>
      <p>Just a friendly reminder that invoice for <strong>${money(inv.amount, inv.currency)}</strong>,
      due ${inv.due_date}, hasn't come through yet. If it's already on its way, please disregard this.</p>
      <p>Thanks!</p>`,
  }),
  '2nd': (inv) => ({
    subject: `Invoice ${inv.id.slice(0, 8)} — second reminder`,
    html: `<p>Hi,</p>
      <p>Following up again on the invoice for <strong>${money(inv.amount, inv.currency)}</strong>,
      which was due ${inv.due_date} and is now overdue. Could you let me know when payment is expected?</p>
      <p>Thanks!</p>`,
  }),
  final: (inv) => ({
    subject: `Invoice ${inv.id.slice(0, 8)} — final notice`,
    html: `<p>Hi,</p>
      <p>This is a final reminder for the invoice of <strong>${money(inv.amount, inv.currency)}</strong>,
      now significantly overdue (originally due ${inv.due_date}). Please reach out if there's an issue
      so we can sort it out.</p>
      <p>Thanks!</p>`,
  }),
};

export async function sendReminderEmail(invoice, recipientEmail) {
  const template = TEMPLATES[invoice.reminder_level];
  if (!template) throw new Error(`No email template for reminder level "${invoice.reminder_level}"`);
  const { subject, html } = template(invoice);

  return resend.emails.send({
    from: process.env.REMINDERS_FROM_EMAIL,
    to: recipientEmail,
    subject,
    html,
  });
}
