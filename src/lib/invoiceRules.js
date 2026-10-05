import { setupFor, addressLines } from './countries.js';

// Decides whether an invoice is a "full" invoice or a simplified small-value one,
// and lists what is still missing before it can be sent. Drafts can always be saved.

// Everything about the seller that appears on an invoice, frozen when it is sent
// so later profile changes never rewrite an invoice that already went out.
export function sellerSnapshot(b) {
  return {
    name: b.name,
    legal_name: b.legal_name || null,
    street: b.street || null,
    postal_code: b.postal_code || null,
    city: b.city || null,
    region: b.region || null,
    country: b.country || 'AT',
    tax_number: b.tax_number || null,
    vat_number: b.vat_number || null,
    tax_mode: b.tax_mode || 'vat',
    contact_email: b.contact_email || null,
    contact_phone: b.contact_phone || null,
    website: b.website || null,
    bank: {
      holder: b.bank_holder || null,
      iban: b.bank_iban || null,
      bic: b.bank_bic || null,
      name: b.bank_name || null,
      account_number: b.bank_account_number || null,
      routing_code: b.bank_routing_code || null,
    },
    footer: b.invoice_footer || null,
  };
}

export function chooseMode({ seller, grossCents, currency, clientCountry, requested }) {
  if (requested === 'full') return 'full';
  const setup = setupFor(seller.country);
  const sv = setup.smallValue;
  if (!sv || currency !== sv.currency) return 'full';
  if (grossCents > sv.limit * 100) return 'full';
  // A customer in another country is not a plain domestic small-value sale.
  if (clientCountry && clientCountry !== seller.country) return 'full';
  return 'simplified';
}

export function checkInvoice({ seller, invoice, items, mode, grossCents }) {
  const setup = setupFor(seller.country);
  const missing = [];
  const warnings = [];
  const need = (id, where, message) => missing.push({ id, where, message });

  // The seller (always required)
  if (!(seller.legal_name || seller.name)) need('seller_name', 'profile', 'Add your business name in Settings.');
  if (!seller.street || !seller.postal_code || !seller.city) need('seller_address', 'profile', 'Add your business address (street, postcode and city) in Settings.');
  if (setup.needsRegion && !seller.region) need('seller_region', 'profile', 'Add your state in the business address in Settings.');

  // Tax identification
  if (seller.tax_mode === 'vat' && mode === 'full') {
    const rule = setup.rules?.fullVatNeedsUid;
    if (rule === 'uid' && !seller.vat_number) {
      need('seller_uid', 'profile', `Add your ${setup.vatIdLabel} in Settings. Full invoices that charge VAT need it.`);
    } else if (rule === 'either' && !seller.vat_number && !seller.tax_number) {
      need('seller_tax_id', 'profile', `Add your ${setup.taxIdLabel} or ${setup.vatIdLabel} in Settings. Invoices that charge VAT need one of them.`);
    }
  }

  // The customer
  if (!invoice.client_name) need('client_name', 'invoice', 'Add the customer name.');
  if (mode === 'full' && (!invoice.client_street || !invoice.client_postal_code || !invoice.client_city)) {
    need('client_address', 'invoice', 'Add the customer address (street, postcode and city). A full invoice needs it.');
  }
  const big = setup.rules?.recipientUidAbove;
  if (big && seller.tax_mode === 'vat' && invoice.currency === big.currency && grossCents > big.amount * 100 && !invoice.client_tax_id) {
    need('client_uid', 'invoice', `Add the customer's UID number. Invoices over ${big.amount} ${big.currency} need it.`);
  }

  // The invoice itself
  if (!items.length) need('items', 'invoice', 'Add at least one line to the invoice.');
  if (items.some((i) => !String(i.description || '').trim())) need('item_description', 'invoice', 'Every line needs a description.');
  if (!invoice.service_date) need('service_date', 'invoice', 'Add the delivery or service date (or period).');
  if (!invoice.issue_date) need('issue_date', 'invoice', 'Add the invoice date.');
  if (invoice.due_date && invoice.issue_date && invoice.due_date < invoice.issue_date) need('due_date', 'invoice', 'The due date can not be before the invoice date.');

  // Helpful, not blocking
  const b = seller.bank || {};
  if (!b.iban && !b.account_number) warnings.push('Add your bank details in Settings so customers know where to pay.');
  if (!seller.vat_number && !seller.tax_number) warnings.push('Add your tax number in Settings. It is usually expected on invoices.');

  return { missing, warnings };
}

export function sellerAddress(seller) {
  return addressLines(seller);
}
