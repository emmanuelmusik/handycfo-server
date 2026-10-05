import { Resend } from 'resend';
import { tr, localeFor, fmtMoney, fmtDate } from './invoiceI18n.js';

let resendClient;
function getResend() {
  if (!process.env.RESEND_API_KEY) throw new Error('Email is not configured (missing RESEND_API_KEY on the server).');
  resendClient ||= new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function money(amount, currency) {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(amount);
}

const TEMPLATES = {
  '1st': (inv) => ({
    subject: `Invoice ${(inv.invoice_number || inv.id.slice(0, 8).toUpperCase())} — payment reminder`,
    html: `<p>Hi,</p>
      <p>Just a friendly reminder that invoice for <strong>${money(inv.amount, inv.currency)}</strong>,
      due ${inv.due_date}, hasn't come through yet. If it's already on its way, please disregard this.</p>
      <p>Thanks!</p>`,
  }),
  '2nd': (inv) => ({
    subject: `Invoice ${(inv.invoice_number || inv.id.slice(0, 8).toUpperCase())} — second reminder`,
    html: `<p>Hi,</p>
      <p>Following up again on the invoice for <strong>${money(inv.amount, inv.currency)}</strong>,
      which was due ${inv.due_date} and is now overdue. Could you let me know when payment is expected?</p>
      <p>Thanks!</p>`,
  }),
  final: (inv) => ({
    subject: `Invoice ${(inv.invoice_number || inv.id.slice(0, 8).toUpperCase())} — final notice`,
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

  return getResend().emails.send({
    from: process.env.REMINDERS_FROM_EMAIL,
    to: recipientEmail,
    subject,
    html,
  });
}

// The first email: the invoice itself, written in the invoice's language.
// Replies go to the freelancer, not to our sending address.
export async function sendInvoiceEmail({ invoice, businessName, recipientEmail, replyTo, pdf }) {
  const number = invoice.invoice_number || invoice.id.slice(0, 8).toUpperCase();
  const lang = invoice.language || 'en';
  const locale = localeFor(lang, invoice.client_country);
  const T = (k, v) => tr(lang, k, v);
  const { data, error } = await getResend().emails.send({
    from: process.env.REMINDERS_FROM_EMAIL,
    to: recipientEmail,
    replyTo: replyTo || undefined,
    attachments: pdf ? [{ filename: `${T('invoice')}-${number}.pdf`, content: pdf }] : undefined,
    subject: T('subject', { number, business: businessName }),
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1c2420">
      <p>${esc(T('hello', { name: invoice.client_name }))}</p>
      <p>${esc(T('sentLine', { business: businessName }))}</p>
      <table style="border-collapse:collapse;width:100%;margin:18px 0">
        <tr><td style="padding:8px 0;color:#667">${esc(T('invoice'))}</td><td style="padding:8px 0;text-align:right"><strong>${esc(number)}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#667">${esc(T('issued'))}</td><td style="padding:8px 0;text-align:right">${esc(fmtDate(locale, invoice.issue_date))}</td></tr>
        <tr><td style="padding:8px 0;color:#667">${esc(T('due'))}</td><td style="padding:8px 0;text-align:right">${esc(fmtDate(locale, invoice.due_date))}</td></tr>
        <tr><td style="padding:12px 0;border-top:1px solid #ddd"><strong>${esc(T('amountDue'))}</strong></td><td style="padding:12px 0;border-top:1px solid #ddd;text-align:right"><strong style="font-size:18px">${esc(fmtMoney(locale, invoice.amount, invoice.currency))}</strong></td></tr>
      </table>
      <p>${esc(T('payNote'))}</p>
      <p>${esc(T('thanks'))}<br>${esc(businessName)}</p>
    </div>`,
  });
  if (error) throw new Error(error.message || 'The email could not be sent');
  return data;
}
