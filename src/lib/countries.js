// Country setups: what an invoice needs in each country, and what to call things.
// This file is identical on the server and in the app (keep both copies in sync).
// The rules here are a careful starting point, NOT tax advice: have a local
// accountant confirm them for the countries you actually serve.

export const COUNTRIES = [
  ['AT', 'Austria'], ['DE', 'Germany'], ['CH', 'Switzerland'], ['FR', 'France'], ['IT', 'Italy'],
  ['ES', 'Spain'], ['PT', 'Portugal'], ['NL', 'Netherlands'], ['BE', 'Belgium'], ['IE', 'Ireland'],
  ['LU', 'Luxembourg'], ['GB', 'United Kingdom'], ['US', 'United States'], ['CA', 'Canada'],
  ['AU', 'Australia'], ['NZ', 'New Zealand'], ['SE', 'Sweden'], ['NO', 'Norway'], ['DK', 'Denmark'],
  ['FI', 'Finland'], ['PL', 'Poland'], ['CZ', 'Czechia'], ['SK', 'Slovakia'], ['HU', 'Hungary'],
  ['SI', 'Slovenia'], ['HR', 'Croatia'], ['GR', 'Greece'], ['RO', 'Romania'], ['BG', 'Bulgaria'],
  ['TR', 'Turkey'], ['BR', 'Brazil'], ['MX', 'Mexico'], ['IN', 'India'], ['ZA', 'South Africa'],
  ['NG', 'Nigeria'], ['AE', 'United Arab Emirates'], ['SG', 'Singapore'], ['JP', 'Japan'], ['KR', 'South Korea'],
  ['ID', 'Indonesia'], ['OTHER', 'Other country'],
];

const NAMES = Object.fromEntries(COUNTRIES);
export const countryName = (code) => NAMES[code] || code || '';

export const TAX_MODES = {
  vat: 'I charge VAT',
  small_business: 'Small business, no VAT charged (Kleinunternehmer)',
  sales_tax: 'I charge sales tax',
  none: 'I do not charge VAT or sales tax',
};

const GENERIC = {
  code: 'OTHER',
  currency: 'EUR',
  paper: 'A4',
  addressStyle: 'eu',
  needsRegion: false,
  taxIdLabel: 'Tax ID',
  vatIdLabel: 'VAT / tax registration number',
  vatPlaceholder: '',
  taxTerm: 'vat',
  taxModes: ['vat', 'small_business', 'sales_tax', 'none'],
  defaultTaxMode: 'vat',
  rates: [0],
  defaultRate: 0,
  bank: 'generic',
  smallValue: null,
  wording: 'generic',
};

export const SETUPS = {
  AT: {
    ...GENERIC, code: 'AT', currency: 'EUR', taxIdLabel: 'Steuernummer', vatIdLabel: 'UID-Nummer',
    vatPlaceholder: 'ATU12345678', taxModes: ['vat', 'small_business'], rates: [20, 13, 10, 0], defaultRate: 20,
    bank: 'iban', smallValue: { limit: 400, currency: 'EUR' }, wording: 'AT',
    rules: { fullVatNeedsUid: 'uid', recipientUidAbove: { amount: 10000, currency: 'EUR' } },
  },
  DE: {
    ...GENERIC, code: 'DE', currency: 'EUR', taxIdLabel: 'Steuernummer', vatIdLabel: 'USt-IdNr.',
    vatPlaceholder: 'DE123456789', taxModes: ['vat', 'small_business'], rates: [19, 7, 0], defaultRate: 19,
    bank: 'iban', smallValue: { limit: 250, currency: 'EUR' }, wording: 'DE',
    rules: { fullVatNeedsUid: 'either' },
  },
  GB: {
    ...GENERIC, code: 'GB', currency: 'GBP', addressStyle: 'uk', taxIdLabel: 'Company / tax number', vatIdLabel: 'VAT registration number',
    vatPlaceholder: 'GB123456789', taxModes: ['vat', 'none'], rates: [20, 5, 0], defaultRate: 20,
    bank: 'uk', smallValue: { limit: 250, currency: 'GBP' }, wording: 'generic',
    rules: {},
  },
  US: {
    ...GENERIC, code: 'US', currency: 'USD', paper: 'LETTER', addressStyle: 'us', needsRegion: true,
    taxIdLabel: 'Tax ID (EIN)', vatIdLabel: '', taxTerm: 'sales_tax', taxModes: ['none', 'sales_tax'],
    defaultTaxMode: 'none', rates: [], defaultRate: 0, bank: 'us', smallValue: null, wording: 'generic',
    rules: {},
  },
};

export function setupFor(code) {
  return SETUPS[code] || { ...GENERIC, code: code || 'OTHER', addressStyle: ['CA', 'AU', 'NZ'].includes(code) ? 'us' : 'eu', needsRegion: ['CA', 'AU'].includes(code), paper: ['CA'].includes(code) ? 'LETTER' : 'A4' };
}

// "Street / 1010 Vienna / Austria" as separate lines, in the style of the country.
export function addressLines({ street, postal_code, city, region, country }) {
  const style = setupFor(country).addressStyle;
  const lines = [];
  if (street) lines.push(String(street).trim());
  let cityLine = '';
  if (style === 'us') cityLine = [city, [region, postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  else if (style === 'uk') cityLine = [city, region, postal_code].filter(Boolean).join(', ');
  else cityLine = [postal_code, city].filter(Boolean).join(' ');
  if (cityLine) lines.push(cityLine);
  if (country && country !== 'OTHER') lines.push(countryName(country));
  return lines;
}

export const INVOICE_LANGUAGES = [
  ['en', 'English'], ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'], ['pt', 'Português'], ['it', 'Italiano'],
];

// ---------- bank helpers ----------
export const cleanIban = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();

// Checks the length-agnostic IBAN checksum (mod 97), so typos are caught early.
export function ibanValid(raw) {
  const iban = cleanIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

export const formatIban = (raw) => cleanIban(raw).replace(/(.{4})/g, '$1 ').trim();
