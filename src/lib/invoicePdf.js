import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { setupFor, addressLines, cleanIban, ibanValid, formatIban } from './countries.js';
import { computeInvoice, fromCents } from './invoiceMath.js';
import { tr, localeFor, fmtMoney, fmtDate, fmtNumber } from './invoiceI18n.js';

// Draws the invoice and returns it as a Buffer. Uses the built-in PDF fonts, so
// nothing extra needs installing (they cover Western European languages).

const INK = '#1c2420';
const SOFT = '#6b7570';
const LINE = '#dfe4e1';
const ACCENT = '#2f9e80';
const MARGIN = 50;

export function invoiceNumber(invoice) {
  return invoice.invoice_number || String(invoice.id).slice(0, 8).toUpperCase();
}

// The text inside a SEPA payment QR code ("GiroCode"), which banking apps read.
export function epcPayload({ name, iban, bic, amount, remittance }) {
  return [
    'BCD', '002', '1', 'SCT', bic || '', String(name || '').slice(0, 70), cleanIban(iban),
    `EUR${Number(amount).toFixed(2)}`, '', '', String(remittance || '').slice(0, 140),
  ].join('\n');
}

export async function renderInvoicePdf({ invoice, items, seller }) {
  const lang = invoice.language || 'en';
  const setup = setupFor(seller.country);
  const locale = localeFor(lang, seller.country);
  const T = (k, v) => tr(lang, k, v);
  const money = (n) => fmtMoney(locale, n, invoice.currency);
  const isDraft = invoice.status === 'Draft' && !invoice.invoice_number;
  const number = isDraft ? T('draft') : invoiceNumber(invoice);

  const taxEnabled = seller.tax_mode === 'vat' || seller.tax_mode === 'sales_tax';
  const taxName = seller.tax_mode === 'sales_tax' ? T('salesTax') : T('vat');

  // Invoices created before line items existed are shown as a single line.
  let rows = items || [];
  const legacy = rows.length === 0;
  if (legacy) rows = [{ description: T('legacyService', { name: seller.legal_name || seller.name }), quantity: 1, unitPrice: Number(invoice.amount), taxRate: 0 }];
  const calc = computeInvoice(rows, { includeTax: !!invoice.prices_include_tax && !legacy, taxEnabled: taxEnabled && !legacy });
  const showTaxCol = taxEnabled && !legacy;
  const gross = legacy ? Number(invoice.amount) : fromCents(calc.grossCents);

  const qrOk = invoice.currency === 'EUR' && seller.bank?.iban && ibanValid(seller.bank.iban);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: setup.paper === 'LETTER' ? 'LETTER' : 'A4',
      margin: MARGIN,
      bufferPages: true,
      info: { Title: `${T('invoice')} ${number}`, Author: seller.legal_name || seller.name },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = MARGIN;
    const right = doc.page.width - MARGIN;
    const width = right - left;
    const bottom = doc.page.height - MARGIN - 28; // leave room for the page number

    const watermark = () => {
      if (!isDraft) return;
      doc.save();
      doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.font('Helvetica-Bold').fontSize(100);
      const fit = Math.min(100, (100 * doc.page.width * 0.78) / Math.max(doc.widthOfString(T('draft')), 1));
      doc.fillColor('#c0392b').opacity(0.07).fontSize(fit)
        .text(T('draft'), 0, doc.page.height / 2 - fit * 0.55, { width: doc.page.width, align: 'center', lineBreak: false });
      doc.restore();
      doc.opacity(1);
    };
    watermark();
    doc.on('pageAdded', watermark);

    const text = (str, x, y, opts = {}) => doc.text(String(str), x, y, opts);
    const label = (str, x, y, opts) => text(String(str).toUpperCase(), x, y, opts);

    // ---------- header: seller ----------
    doc.fillColor(ACCENT).rect(left, MARGIN, 36, 4).fill();
    let ly = MARGIN + 14;
    const sellerName = seller.legal_name || seller.name;
    doc.font('Helvetica-Bold').fontSize(17).fillColor(INK);
    text(sellerName, left, ly, { width: width * 0.56 });
    ly = doc.y + 2;
    doc.font('Helvetica').fontSize(9.5).fillColor(SOFT);
    if (seller.legal_name && seller.name && seller.name !== seller.legal_name) { text(seller.name, left, ly, { width: width * 0.56 }); ly = doc.y; }
    for (const line of addressLines(seller)) { text(line, left, ly, { width: width * 0.56 }); ly = doc.y; }
    const contact = [seller.contact_email, seller.contact_phone, seller.website].filter(Boolean).join('  ·  ');
    if (contact) { text(contact, left, ly + 2, { width: width * 0.56 }); ly = doc.y; }

    const ids = [];
    const taxLabel = (setup.code === 'AT' || setup.code === 'DE') ? 'Steuernummer' : (lang === 'en' ? setup.taxIdLabel : T('taxNumber'));
    const vatLabel = setup.code === 'AT' ? 'UID-Nr.' : setup.code === 'DE' ? 'USt-IdNr.' : T('vatId');
    if (seller.tax_number) ids.push(`${taxLabel}: ${seller.tax_number}`);
    if (seller.vat_number) ids.push(`${vatLabel}: ${seller.vat_number}`);
    ids.forEach((l, i) => { text(l, left, ly + (i === 0 ? 2 : 0), { width: width * 0.56 }); ly = doc.y; });

    // ---------- header: title ----------
    doc.font('Helvetica-Bold').fontSize(24).fillColor(INK);
    text(T('invoice').toUpperCase(), left, MARGIN + 10, { width, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor(isDraft ? '#c0392b' : SOFT);
    text(isDraft ? T('draft') : `${T('invoiceNo')} ${number}`, left, MARGIN + 42, { width, align: 'right' });

    // ---------- bill to + dates ----------
    let y = Math.max(ly, MARGIN + 70) + 26;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(SOFT);
    label(T('billTo'), left, y);
    let cy = y + 14;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(INK);
    text(invoice.client_name || '', left, cy, { width: width * 0.52 });
    cy = doc.y + 1;
    doc.font('Helvetica').fontSize(10).fillColor(INK);
    for (const line of addressLines({
      street: invoice.client_street, postal_code: invoice.client_postal_code, city: invoice.client_city,
      region: invoice.client_region, country: invoice.client_country || '',
    })) { text(line, left, cy, { width: width * 0.52 }); cy = doc.y; }
    if (invoice.client_tax_id) { doc.fillColor(SOFT); text(`${T('customerVatId')}: ${invoice.client_tax_id}`, left, cy + 2, { width: width * 0.52 }); cy = doc.y; }

    const col = left + width * 0.6;
    const labelW = 96;
    let ry = y;
    const meta = (k, v) => {
      doc.font('Helvetica-Bold').fontSize(9.5);
      const h = doc.heightOfString(v, { width: right - col - labelW });
      doc.font('Helvetica').fontSize(9.5).fillColor(SOFT).text(k, col, ry, { width: labelW });
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(v, col + labelW, ry, { width: right - col - labelW, align: 'right' });
      ry += Math.max(h, 12) + 6;
    };
    meta(T('invoiceDate'), fmtDate(locale, invoice.issue_date));
    if (invoice.service_date) {
      const period = invoice.service_end_date && invoice.service_end_date !== invoice.service_date;
      meta(period ? T('servicePeriod') : T('serviceDate'),
        period ? `${fmtDate(locale, invoice.service_date, true)} – ${fmtDate(locale, invoice.service_end_date, true)}` : fmtDate(locale, invoice.service_date));
    }
    meta(T('dueDate'), fmtDate(locale, invoice.due_date));

    y = Math.max(cy, ry) + 28;

    // ---------- items table ----------
    const amountW = 82; const taxW = showTaxCol ? 64 : 0; const unitW = 74; const qtyW = 44;
    const amountX = right - amountW;
    const taxX = amountX - taxW;
    const unitX = taxX - unitW;
    const qtyX = unitX - qtyW;
    const descW = qtyX - left - 12;
    const amountLabel = invoice.prices_include_tax && showTaxCol ? T('amountInclTax') : T('amount');

    const tableHeader = (yy) => {
      doc.moveTo(left, yy).lineTo(right, yy).strokeColor(INK).lineWidth(1).stroke();
      doc.font('Helvetica-Bold').fontSize(8).fillColor(SOFT);
      label(T('description'), left, yy + 8, { width: descW });
      label(T('qty'), qtyX, yy + 8, { width: qtyW, align: 'right' });
      label(T('unitPrice'), unitX, yy + 8, { width: unitW, align: 'right' });
      if (showTaxCol) label(`${taxName} %`, taxX, yy + 8, { width: taxW, align: 'right' });
      label(amountLabel, amountX - 20, yy + 8, { width: amountW + 20, align: 'right' });
      doc.moveTo(left, yy + 24).lineTo(right, yy + 24).strokeColor(LINE).lineWidth(0.75).stroke();
      return yy + 24;
    };
    y = tableHeader(y);

    for (const l of calc.lines) {
      doc.font('Helvetica').fontSize(10);
      const h = Math.max(doc.heightOfString(l.description || '', { width: descW }), 12) + 14;
      if (y + h > bottom) { doc.addPage(); y = tableHeader(MARGIN); }
      doc.font('Helvetica').fontSize(10).fillColor(INK);
      text(l.description || '', left, y + 7, { width: descW });
      text(fmtNumber(locale, l.quantity), qtyX, y + 7, { width: qtyW, align: 'right' });
      text(money(l.unitPrice), unitX, y + 7, { width: unitW, align: 'right' });
      if (showTaxCol) text(`${fmtNumber(locale, l.taxRate, 2)} %`, taxX, y + 7, { width: taxW, align: 'right' });
      text(money(fromCents(l.amountCents)), amountX, y + 7, { width: amountW, align: 'right' });
      y += h;
      doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).lineWidth(0.75).stroke();
    }

    // ---------- totals ----------
    const totalsW = 300;
    const tx = right - totalsW;
    const totalRow = (k, v, opts = {}) => {
      const size = opts.size || 10;
      if (y + size + 12 > bottom) { doc.addPage(); y = MARGIN; }
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(opts.bold ? INK : SOFT);
      text(k, tx, y, { width: totalsW - 120 });
      text(v, right - 120, y, { width: 120, align: 'right' });
      y += size + 8;
    };
    y += 14;
    const taxRows = showTaxCol ? 1 + calc.groups.filter((g) => g.rate > 0 || calc.groups.length === 1).length : 0;
    if (y + taxRows * 18 + 44 > bottom) { doc.addPage(); y = MARGIN; }
    if (showTaxCol) {
      totalRow(seller.tax_mode === 'sales_tax' ? T('subtotal') : T('subtotalNet'), money(fromCents(calc.netCents)));
      const shown = calc.groups.filter((g) => g.rate > 0 || calc.groups.length === 1);
      for (const g of shown) totalRow(`${taxName} ${fmtNumber(locale, g.rate, 2)} %`, money(fromCents(g.vatCents)));
    }
    y += 2;
    doc.moveTo(tx, y).lineTo(right, y).strokeColor(INK).lineWidth(1).stroke();
    y += 8;
    totalRow(T('amountDue'), money(gross), { bold: true, size: 14 });

    // ---------- tax note ----------
    y += 14;
    if (seller.tax_mode === 'small_business') {
      const key = setup.wording === 'AT' ? 'wordingAT' : setup.wording === 'DE' ? 'wordingDE' : 'wordingGeneric';
      doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(SOFT);
      const h = doc.heightOfString(T(key), { width });
      if (y + h > bottom) { doc.addPage(); y = MARGIN; }
      doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(SOFT);
      text(T(key), left, y, { width });
      y = doc.y + 8;
    }

    // ---------- notes ----------
    if (invoice.notes) {
      doc.font('Helvetica').fontSize(10);
      const h = doc.heightOfString(invoice.notes, { width }) + 24;
      if (y + h > bottom) { doc.addPage(); y = MARGIN; }
      doc.font('Helvetica-Bold').fontSize(8).fillColor(SOFT);
      label(T('notes'), left, y);
      doc.font('Helvetica').fontSize(10).fillColor(INK);
      text(invoice.notes, left, y + 13, { width });
      y = doc.y + 10;
    }

    // ---------- payment ----------
    const bank = seller.bank || {};
    const payLines = [];
    const add = (k, v) => { if (v) payLines.push([T(k), v]); };
    add('accountHolder', bank.holder);
    add('bank', bank.name);
    add('iban', bank.iban && formatIban(bank.iban));
    add('bic', bank.bic);
    add('accountNumber', bank.account_number);
    add(setup.code === 'GB' ? 'sortCode' : 'routing', bank.routing_code);
    if (payLines.length) add('reference', invoice.payment_reference || number);

    const qrSize = 88;
    const textH = payLines.length * 15 + 54;
    const payH = Math.max(textH, qrOk ? qrSize + 44 : 0);
    if (y + payH + 20 > bottom) { doc.addPage(); y = MARGIN; }
    y += 8;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).lineWidth(0.75).stroke();
    y += 14;
    const blockTop = y;
    if (payLines.length) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(SOFT);
      label(T('paymentDetails'), left, y);
      let py = y + 14;
      for (const [k, v] of payLines) {
        doc.font('Helvetica').fontSize(9.5).fillColor(SOFT).text(k, left, py, { width: 112 });
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(v, left + 114, py, { width: width * 0.55 - 114 });
        py += 15;
      }
      doc.font('Helvetica').fontSize(9.5).fillColor(INK);
      text(T('payBy', { date: fmtDate(locale, invoice.due_date) }), left, py + 6, { width: width * 0.6 });
      y = Math.max(doc.y, py + 20);

      if (qrOk) {
        const qx = right - qrSize;
        const payload = epcPayload({
          name: bank.holder || seller.legal_name || seller.name, iban: bank.iban, bic: bank.bic,
          amount: gross, remittance: invoice.payment_reference || number,
        });
        const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
        const n = qr.modules.size;
        const cell = qrSize / n;
        doc.save();
        doc.fillColor('#ffffff').rect(qx - 4, blockTop - 4, qrSize + 8, qrSize + 8).fill();
        doc.fillColor('#000000');
        for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) if (qr.modules.get(r, c)) doc.rect(qx + c * cell, blockTop + r * cell, cell + 0.2, cell + 0.2);
        doc.fill();
        doc.restore();
        doc.font('Helvetica').fontSize(7.5).fillColor(SOFT);
        text(T('scanToPay'), qx - 24, blockTop + qrSize + 6, { width: qrSize + 48, align: 'center' });
        y = Math.max(y, blockTop + qrSize + 26);
      }
    } else {
      doc.font('Helvetica').fontSize(9.5).fillColor(INK);
      text(T('payBy', { date: fmtDate(locale, invoice.due_date) }), left, y, { width });
      y = doc.y;
    }

    // ---------- footer text ----------
    if (seller.footer) {
      doc.font('Helvetica').fontSize(9.5);
      const h = doc.heightOfString(seller.footer, { width });
      if (y + h + 14 > bottom) { doc.addPage(); y = MARGIN; }
      doc.font('Helvetica').fontSize(9.5).fillColor(SOFT);
      text(seller.footer, left, y + 14, { width });
    }

    // ---------- page numbers ----------
    const range = doc.bufferedPageRange();
    if (range.count > 1) {
      for (let i = 0; i < range.count; i += 1) {
        doc.switchToPage(range.start + i);
        const saved = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.font('Helvetica').fontSize(8).fillColor(SOFT);
        text(T('page', { n: i + 1, m: range.count }), left, doc.page.height - MARGIN + 6, { width, align: 'right', lineBreak: false });
        doc.page.margins.bottom = saved;
      }
    }

    doc.end();
  });
}
