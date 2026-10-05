// Invoice arithmetic in whole cents, so totals never drift by a cent from
// floating-point maths. Identical on the server and in the app.

const cents = (n) => Math.round(Number(n) * 100 + (Number(n) >= 0 ? 1e-7 : -1e-7));

// Returns { lines, groups, netCents, vatCents, grossCents }.
//   items:      [{ description, quantity, unitPrice, taxRate }]
//   includeTax: unit prices already contain the tax
//   taxEnabled: false means no tax at all (small business, no VAT, ...)
export function computeInvoice(items, { includeTax = false, taxEnabled = true } = {}) {
  const lines = (items || []).map((it) => {
    const qtyMilli = Math.round(Number(it.quantity || 0) * 1000);
    const unit = cents(it.unitPrice || 0);
    const amountCents = Math.floor((qtyMilli * unit + 500) / 1000); // half-up
    const rate = taxEnabled ? Number(it.taxRate || 0) : 0;
    return { ...it, quantity: Number(it.quantity || 0), unitPrice: Number(it.unitPrice || 0), taxRate: rate, amountCents };
  });

  // Tax is worked out once per rate (not per line), the usual way on invoices.
  const byRate = new Map();
  for (const l of lines) byRate.set(l.taxRate, (byRate.get(l.taxRate) || 0) + l.amountCents);

  const groups = [...byRate.entries()].sort((a, b) => b[0] - a[0]).map(([rate, sum]) => {
    const r = Math.round(rate * 100); // basis points
    let net; let vat; let gross;
    if (includeTax) {
      gross = sum;
      vat = r === 0 ? 0 : Math.floor((2 * gross * r + (10000 + r)) / (2 * (10000 + r)));
      net = gross - vat;
    } else {
      net = sum;
      vat = Math.floor((net * r + 5000) / 10000);
      gross = net + vat;
    }
    return { rate, netCents: net, vatCents: vat, grossCents: gross };
  });

  return {
    lines,
    groups,
    netCents: groups.reduce((s, g) => s + g.netCents, 0),
    vatCents: groups.reduce((s, g) => s + g.vatCents, 0),
    grossCents: groups.reduce((s, g) => s + g.grossCents, 0),
  };
}

export const fromCents = (c) => Math.round(c) / 100;
