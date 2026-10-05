import PDFDocument from 'pdfkit';

// Draws a clean one-page invoice and returns it as a Buffer.
// Uses the built-in Helvetica font, so there is nothing extra to install.

const INK = '#1c2420';
const SOFT = '#6b7570';
const LINE = '#dfe4e1';
const ACCENT = '#2f9e80';

function money(amount, currency) {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(Number(amount) || 0);
}

function niceDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function invoiceNumber(invoice) {
  return invoice.id.slice(0, 8).toUpperCase();
}

export function renderInvoicePdf({ invoice, business }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `Invoice ${invoiceNumber(invoice)}`, Author: business.name } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    // Header
    doc.fillColor(ACCENT).rect(left, 56, 36, 4).fill();
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text(business.name, left, 72, { width: width * 0.6 });
    doc.font('Helvetica').fontSize(10).fillColor(SOFT);
    if (business.vat_number) doc.text(`VAT ID: ${business.vat_number}`, left, doc.y + 2);

    doc.font('Helvetica-Bold').fontSize(26).fillColor(INK).text('INVOICE', left, 72, { width, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor(SOFT).text(`No. ${invoiceNumber(invoice)}`, left, 104, { width, align: 'right' });

    // Bill to + dates
    const top = 170;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(SOFT).text('BILL TO', left, top);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(invoice.client_name, left, top + 16, { width: width * 0.5 });
    if (invoice.client_email) doc.font('Helvetica').fontSize(10).fillColor(SOFT).text(invoice.client_email, left, doc.y + 2, { width: width * 0.5 });

    const col = left + width * 0.62;
    const labelW = 80;
    const row = (label, value, y) => {
      doc.font('Helvetica').fontSize(10).fillColor(SOFT).text(label, col, y, { width: labelW });
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(value, col + labelW, y, { width: right - col - labelW, align: 'right' });
    };
    row('Issue date', niceDate(invoice.issue_date), top);
    row('Due date', niceDate(invoice.due_date), top + 20);
    row('Currency', invoice.currency, top + 40);

    // Table
    const tableTop = 280;
    doc.moveTo(left, tableTop).lineTo(right, tableTop).strokeColor(INK).lineWidth(1).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(SOFT)
      .text('DESCRIPTION', left, tableTop + 10)
      .text('AMOUNT', left, tableTop + 10, { width, align: 'right' });
    doc.moveTo(left, tableTop + 28).lineTo(right, tableTop + 28).strokeColor(LINE).lineWidth(0.75).stroke();

    doc.font('Helvetica').fontSize(11).fillColor(INK)
      .text(`Services provided by ${business.name}`, left, tableTop + 42, { width: width * 0.7 })
      .text(money(invoice.amount, invoice.currency), left, tableTop + 42, { width, align: 'right' });
    doc.moveTo(left, tableTop + 72).lineTo(right, tableTop + 72).strokeColor(LINE).lineWidth(0.75).stroke();

    // Total
    const totalY = tableTop + 92;
    doc.font('Helvetica').fontSize(10).fillColor(SOFT).text('Amount due', left, totalY + 4, { width: width * 0.62, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text(money(invoice.amount, invoice.currency), left, totalY, { width, align: 'right' });

    // Footer note
    doc.font('Helvetica').fontSize(10).fillColor(SOFT).text(
      `Please pay by ${niceDate(invoice.due_date)}. If you have any questions about this invoice, just reply to the email it came with.`,
      left, 700, { width, align: 'left' }
    );
    doc.moveTo(left, 690).lineTo(right, 690).strokeColor(LINE).lineWidth(0.75).stroke();

    doc.end();
  });
}
