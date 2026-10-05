// Words printed on invoices and invoice emails, in the invoice language.
// The wording of tax notes should be checked by someone who knows the country's
// rules before real use: these are good-faith drafts.

export const LANGS = ['en', 'de', 'es', 'fr', 'pt', 'it'];

const D = {
  en: {
    invoice: 'Invoice', draft: 'DRAFT', invoiceNo: 'Invoice no.', invoiceDate: 'Invoice date', dueDate: 'Due date',
    serviceDate: 'Service date', servicePeriod: 'Service period', billTo: 'Bill to', description: 'Description',
    qty: 'Qty', unitPrice: 'Unit price', amount: 'Amount', amountInclTax: 'Amount (incl. tax)',
    vat: 'VAT', salesTax: 'Sales tax', tax: 'Tax',
    subtotal: 'Subtotal',
    subtotalNet: 'Subtotal (net)', total: 'Total', amountDue: 'Amount due', includes: 'Includes {tax} {rate}%',
    paymentDetails: 'Payment details', accountHolder: 'Account holder', bank: 'Bank', iban: 'IBAN', bic: 'BIC',
    accountNumber: 'Account number', routing: 'Routing number', sortCode: 'Sort code', reference: 'Payment reference',
    payBy: 'Please pay by {date}.', scanToPay: 'Scan to pay with your banking app',
    taxNumber: 'Tax number', vatId: 'VAT ID', customerVatId: 'Customer VAT ID', notes: 'Notes', page: 'Page {n} of {m}',
    legacyService: 'Services provided by {name}',
    subject: 'Invoice {number} from {business}', hello: 'Hello {name},',
    sentLine: '{business} has sent you an invoice. It is attached to this email as a PDF.',
    issued: 'Issued', due: 'Due', payNote: 'Please pay by the due date. If you have any questions, just reply to this email.',
    thanks: 'Thank you,',
    wordingGeneric: 'VAT not charged (small business exemption).',
    wordingAT: 'VAT exempt – small business (§ 6 (1) no. 27 Austrian VAT Act, UStG).',
    wordingDE: 'No VAT charged – small business under § 19 of the German VAT Act (UStG).',
  },
  de: {
    invoice: 'Rechnung', draft: 'ENTWURF', invoiceNo: 'Rechnungsnummer', invoiceDate: 'Rechnungsdatum', dueDate: 'Fälligkeitsdatum',
    serviceDate: 'Leistungsdatum', servicePeriod: 'Leistungszeitraum', billTo: 'Rechnungsempfänger', description: 'Beschreibung',
    qty: 'Menge', unitPrice: 'Einzelpreis', amount: 'Betrag', amountInclTax: 'Betrag (inkl. Steuer)',
    vat: 'USt.', salesTax: 'Verkaufssteuer', tax: 'Steuer',
    subtotal: 'Zwischensumme',
    subtotalNet: 'Zwischensumme (netto)', total: 'Gesamtbetrag', amountDue: 'Zu zahlender Betrag', includes: 'Enthält {rate} % {tax}',
    paymentDetails: 'Zahlungsinformationen', accountHolder: 'Kontoinhaber', bank: 'Bank', iban: 'IBAN', bic: 'BIC',
    accountNumber: 'Kontonummer', routing: 'Routing-Nummer', sortCode: 'Sort Code', reference: 'Zahlungsreferenz',
    payBy: 'Bitte überweisen Sie bis {date}.', scanToPay: 'Mit der Banking-App scannen und bezahlen',
    taxNumber: 'Steuernummer', vatId: 'UID-Nr.', customerVatId: 'UID des Empfängers', notes: 'Anmerkungen', page: 'Seite {n} von {m}',
    legacyService: 'Leistungen von {name}',
    subject: 'Rechnung {number} von {business}', hello: 'Guten Tag {name},',
    sentLine: '{business} hat Ihnen eine Rechnung gesendet. Sie ist dieser E-Mail als PDF angehängt.',
    issued: 'Ausgestellt', due: 'Fällig', payNote: 'Bitte zahlen Sie bis zum Fälligkeitsdatum. Bei Fragen antworten Sie einfach auf diese E-Mail.',
    thanks: 'Vielen Dank,',
    wordingGeneric: 'Umsatzsteuer wird nicht ausgewiesen (Kleinunternehmerregelung).',
    wordingAT: 'Umsatzsteuerbefreit – Kleinunternehmer gemäß § 6 Abs. 1 Z 27 UStG.',
    wordingDE: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmer).',
  },
  es: {
    invoice: 'Factura', draft: 'BORRADOR', invoiceNo: 'Factura n.º', invoiceDate: 'Fecha de factura', dueDate: 'Fecha de vencimiento',
    serviceDate: 'Fecha de prestación', servicePeriod: 'Período de prestación', billTo: 'Facturar a', description: 'Descripción',
    qty: 'Cant.', unitPrice: 'Precio unit.', amount: 'Importe', amountInclTax: 'Importe (impuestos incl.)',
    vat: 'IVA', salesTax: 'Impuesto sobre ventas', tax: 'Impuesto',
    subtotal: 'Subtotal',
    subtotalNet: 'Subtotal (neto)', total: 'Total', amountDue: 'Importe a pagar', includes: 'Incluye {tax} {rate} %',
    paymentDetails: 'Datos de pago', accountHolder: 'Titular de la cuenta', bank: 'Banco', iban: 'IBAN', bic: 'BIC',
    accountNumber: 'Número de cuenta', routing: 'Número de ruta (ABA)', sortCode: 'Sort code', reference: 'Referencia de pago',
    payBy: 'Por favor, pague antes del {date}.', scanToPay: 'Escanee para pagar con su app bancaria',
    taxNumber: 'N.º de identificación fiscal', vatId: 'N.º IVA', customerVatId: 'N.º IVA del cliente', notes: 'Notas', page: 'Página {n} de {m}',
    legacyService: 'Servicios prestados por {name}',
    subject: 'Factura {number} de {business}', hello: 'Hola {name}:',
    sentLine: '{business} le ha enviado una factura. Va adjunta a este correo en PDF.',
    issued: 'Emitida', due: 'Vence', payNote: 'Por favor, pague antes de la fecha de vencimiento. Si tiene alguna pregunta, responda a este correo.',
    thanks: 'Gracias,',
    wordingGeneric: 'IVA no repercutido (exención de pequeña empresa).',
    wordingAT: 'Exento de IVA – pequeña empresa (§ 6 apdo. 1 n.º 27 de la ley austriaca del IVA, UStG).',
    wordingDE: 'Sin IVA – pequeña empresa según el § 19 de la ley alemana del IVA (UStG).',
  },
  fr: {
    invoice: 'Facture', draft: 'BROUILLON', invoiceNo: 'Facture n°', invoiceDate: 'Date de facture', dueDate: "Date d'échéance",
    serviceDate: 'Date de prestation', servicePeriod: 'Période de prestation', billTo: 'Facturé à', description: 'Description',
    qty: 'Qté', unitPrice: 'Prix unitaire', amount: 'Montant', amountInclTax: 'Montant (TTC)',
    vat: 'TVA', salesTax: 'Taxe de vente', tax: 'Taxe',
    subtotal: 'Sous-total',
    subtotalNet: 'Sous-total HT', total: 'Total', amountDue: 'Montant à payer', includes: 'Dont {tax} {rate} %',
    paymentDetails: 'Coordonnées de paiement', accountHolder: 'Titulaire du compte', bank: 'Banque', iban: 'IBAN', bic: 'BIC',
    accountNumber: 'Numéro de compte', routing: "Numéro d'acheminement (ABA)", sortCode: 'Sort code', reference: 'Référence de paiement',
    payBy: 'Merci de régler avant le {date}.', scanToPay: "Scannez pour payer avec votre application bancaire",
    taxNumber: 'N° fiscal', vatId: 'N° de TVA', customerVatId: 'N° de TVA du client', notes: 'Remarques', page: 'Page {n} sur {m}',
    legacyService: 'Prestations de {name}',
    subject: 'Facture {number} de {business}', hello: 'Bonjour {name},',
    sentLine: '{business} vous a envoyé une facture. Elle est jointe à cet e-mail au format PDF.',
    issued: 'Émise le', due: 'Échéance', payNote: "Merci de régler avant la date d'échéance. Pour toute question, répondez simplement à cet e-mail.",
    thanks: 'Merci,',
    wordingGeneric: 'TVA non applicable (régime de la petite entreprise).',
    wordingAT: "Exonéré de TVA – petite entreprise (§ 6 al. 1 n° 27 de la loi autrichienne sur la TVA, UStG).",
    wordingDE: "TVA non facturée – petite entreprise selon le § 19 de la loi allemande sur la TVA (UStG).",
  },
  pt: {
    invoice: 'Fatura', draft: 'RASCUNHO', invoiceNo: 'Fatura n.º', invoiceDate: 'Data da fatura', dueDate: 'Data de vencimento',
    serviceDate: 'Data da prestação', servicePeriod: 'Período da prestação', billTo: 'Faturar a', description: 'Descrição',
    qty: 'Qtd.', unitPrice: 'Preço unit.', amount: 'Valor', amountInclTax: 'Valor (impostos incl.)',
    vat: 'IVA', salesTax: 'Imposto sobre vendas', tax: 'Imposto',
    subtotal: 'Subtotal',
    subtotalNet: 'Subtotal (sem impostos)', total: 'Total', amountDue: 'Valor a pagar', includes: 'Inclui {tax} {rate} %',
    paymentDetails: 'Dados de pagamento', accountHolder: 'Titular da conta', bank: 'Banco', iban: 'IBAN', bic: 'BIC',
    accountNumber: 'Número da conta', routing: 'Número de roteamento (ABA)', sortCode: 'Sort code', reference: 'Referência de pagamento',
    payBy: 'Por favor, pague até {date}.', scanToPay: 'Digitalize para pagar com a sua app bancária',
    taxNumber: 'N.º de contribuinte', vatId: 'N.º de IVA', customerVatId: 'N.º de IVA do cliente', notes: 'Notas', page: 'Página {n} de {m}',
    legacyService: 'Serviços prestados por {name}',
    subject: 'Fatura {number} de {business}', hello: 'Olá {name},',
    sentLine: '{business} enviou-lhe uma fatura. Segue em anexo a este e-mail em PDF.',
    issued: 'Emitida', due: 'Vence', payNote: 'Por favor, pague até à data de vencimento. Em caso de dúvidas, responda a este e-mail.',
    thanks: 'Obrigado,',
    wordingGeneric: 'IVA não cobrado (isenção de pequena empresa).',
    wordingAT: 'Isento de IVA – pequena empresa (§ 6, n.º 1, ponto 27 da lei austríaca do IVA, UStG).',
    wordingDE: 'IVA não cobrado – pequena empresa nos termos do § 19 da lei alemã do IVA (UStG).',
  },
  it: {
    invoice: 'Fattura', draft: 'BOZZA', invoiceNo: 'Fattura n.', invoiceDate: 'Data fattura', dueDate: 'Scadenza',
    serviceDate: 'Data della prestazione', servicePeriod: 'Periodo della prestazione', billTo: 'Intestata a', description: 'Descrizione',
    qty: 'Qtà', unitPrice: 'Prezzo unit.', amount: 'Importo', amountInclTax: 'Importo (imposte incl.)',
    vat: 'IVA', salesTax: 'Imposta sulle vendite', tax: 'Imposta',
    subtotal: 'Subtotale',
    subtotalNet: 'Subtotale (netto)', total: 'Totale', amountDue: 'Importo dovuto', includes: 'Include {tax} {rate}%',
    paymentDetails: 'Dati di pagamento', accountHolder: 'Intestatario', bank: 'Banca', iban: 'IBAN', bic: 'BIC',
    accountNumber: 'Numero di conto', routing: 'Numero di routing (ABA)', sortCode: 'Sort code', reference: 'Riferimento di pagamento',
    payBy: 'Si prega di pagare entro il {date}.', scanToPay: "Inquadra per pagare con la tua app bancaria",
    taxNumber: 'Codice fiscale', vatId: 'Partita IVA', customerVatId: 'Partita IVA del cliente', notes: 'Note', page: 'Pagina {n} di {m}',
    legacyService: 'Servizi forniti da {name}',
    subject: 'Fattura {number} da {business}', hello: 'Buongiorno {name},',
    sentLine: '{business} ti ha inviato una fattura. È allegata a questa email in PDF.',
    issued: 'Emessa', due: 'Scadenza', payNote: 'Si prega di pagare entro la data di scadenza. Per qualsiasi domanda, rispondi a questa email.',
    thanks: 'Grazie,',
    wordingGeneric: 'IVA non addebitata (esenzione per piccole imprese).',
    wordingAT: "Esente IVA – piccola impresa (§ 6 comma 1 n. 27 della legge austriaca sull'IVA, UStG).",
    wordingDE: "IVA non addebitata – piccola impresa ai sensi del § 19 della legge tedesca sull'IVA (UStG).",
  },
};

export function langOf(code) {
  return LANGS.includes(code) ? code : 'en';
}

export function tr(lang, key, vars) {
  let s = (D[langOf(lang)] || D.en)[key] ?? D.en[key] ?? key;
  for (const [k, v] of Object.entries(vars || {})) s = s.split(`{${k}}`).join(String(v));
  return s;
}

// Number and date styles for the invoice language (and country, for English).
export function localeFor(lang, country) {
  switch (langOf(lang)) {
    case 'de': return country === 'AT' ? 'de-AT' : 'de-DE';
    case 'es': return 'es-ES';
    case 'fr': return 'fr-FR';
    case 'pt': return country === 'BR' ? 'pt-BR' : 'pt-PT';
    case 'it': return 'it-IT';
    default: return country === 'US' ? 'en-US' : country === 'GB' ? 'en-GB' : 'en-IE';
  }
}

// The built-in PDF font cannot draw the narrow no-break spaces some locales use.
const plain = (s) => s.replace(/[  ]/g, ' ');

export function fmtMoney(locale, amount, currency) {
  return plain(new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(amount) || 0));
}

export function fmtDate(locale, iso, short = false) {
  if (!iso) return '';
  return plain(new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { day: '2-digit', month: short ? 'short' : 'long', year: 'numeric' }));
}

export function fmtNumber(locale, n, max = 3) {
  return plain(new Intl.NumberFormat(locale, { maximumFractionDigits: max }).format(Number(n) || 0));
}
