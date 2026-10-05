import { Resend } from 'resend';

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

  return getResend().emails.send({
    from: process.env.REMINDERS_FROM_EMAIL,
    to: recipientEmail,
    subject,
    html,
  });
}

// The first email: the invoice itself. Replies go to the freelancer,
// not to our sending address.
export async function sendInvoiceEmail({ invoice, businessName, recipientEmail, replyTo, pdf }) {
  const number = invoice.id.slice(0, 8).toUpperCase();
  const { data, error } = await getResend().emails.send({
    from: process.env.REMINDERS_FROM_EMAIL,
    to: recipientEmail,
    replyTo: replyTo || undefined,
    attachments: pdf ? [{ filename: `Invoice-${number}.pdf`, content: pdf }] : undefined,
    subject: `Invoice ${number} from ${businessName}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1c2420">
      <p>Hello ${esc(invoice.client_name)},</p>
      <p>${esc(businessName)} has sent you an invoice. It is attached to this email as a PDF.</p>
      <table style="border-collapse:collapse;width:100%;margin:18px 0">
        <tr><td style="padding:8px 0;color:#667">Invoice</td><td style="padding:8px 0;text-align:right"><strong>${esc(number)}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#667">Issued</td><td style="padding:8px 0;text-align:right">${esc(invoice.issue_date)}</td></tr>
        <tr><td style="padding:8px 0;color:#667">Due</td><td style="padding:8px 0;text-align:right">${esc(invoice.due_date)}</td></tr>
        <tr><td style="padding:12px 0;border-top:1px solid #ddd"><strong>Amount due</strong></td><td style="padding:12px 0;border-top:1px solid #ddd;text-align:right"><strong style="font-size:18px">${esc(money(invoice.amount, invoice.currency))}</strong></td></tr>
      </table>
      <p>Please pay by the due date. If you have any questions, just reply to this email.</p>
      <p>Thank you,<br>${esc(businessName)}</p>
    </div>`,
  });
  if (error) throw new Error(error.message || 'The email could not be sent');
  return data;
}
