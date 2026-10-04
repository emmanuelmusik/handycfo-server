import Anthropic from '@anthropic-ai/sdk';

// Reads a receipt or invoice (photo or PDF) and returns structured fields.
// We force a tool call so the model answers in a fixed JSON shape instead
// of free text we would have to parse.

export const CATEGORIES = ['Software', 'Travel', 'Office', 'Meals', 'Marketing', 'Materials', 'Shipping', 'Other'];
const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP'];

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

let client;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error('Receipt scanning is not configured yet (missing XAI_API_KEY or ANTHROPIC_API_KEY on the server).');
    err.status = 503;
    throw err;
  }
  client ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const TOOL = {
  name: 'record_receipt',
  description: 'Record the details read from a receipt or supplier invoice.',
  input_schema: {
    type: 'object',
    properties: {
      is_receipt: {
        type: 'boolean',
        description: 'False if the image is not a receipt, invoice or bill at all.',
      },
      merchant: { type: 'string', description: 'The business that issued the document, as printed.' },
      date: { type: ['string', 'null'], description: 'Document date as YYYY-MM-DD, or null if not visible.' },
      total_amount: { type: ['number', 'null'], description: 'Total paid or payable including VAT/tax, or null if not visible.' },
      vat_amount: { type: ['number', 'null'], description: 'The VAT/tax portion included in the total, or null if not shown.' },
      currency: { type: 'string', description: 'ISO 4217 code such as EUR, USD or GBP. Use EUR if unclear and the document looks European.' },
      category: { type: 'string', enum: CATEGORIES },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'How sure you are about the amounts and merchant.' },
      notes: { type: 'string', description: 'One short sentence on anything uncertain (blurry total, multiple totals, etc). Empty if nothing.' },
    },
    required: ['is_receipt', 'merchant', 'date', 'total_amount', 'vat_amount', 'currency', 'category', 'confidence', 'notes'],
  },
};

const PROMPT = `Read this document and call record_receipt.
- total_amount is the final amount paid or due, including tax.
- vat_amount is only the tax part, and only if the document shows it. Do not calculate it yourself.
- Dates are often day/month/year in Europe. Output YYYY-MM-DD.
- Never guess a number you cannot read. Use null and say so in notes.
- Pick the closest category; use Other if none fits.`;

function toContentBlock(buffer, mediaType) {
  const data = buffer.toString('base64');
  if (mediaType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  }
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
}

async function callGrok(buffer, mediaType) {
  const key = process.env.XAI_API_KEY;
  const model = process.env.XAI_MODEL || 'grok-4';
  if (mediaType === 'application/pdf') {
    const err = new Error('Grok reads photos, not PDFs. Please update the app so PDFs are converted first.');
    err.status = 400;
    throw err;
  }
  const schemaHint = `Reply with ONLY a JSON object with exactly these keys:
{"is_receipt": boolean, "merchant": string, "date": "YYYY-MM-DD" or null, "total_amount": number or null, "vat_amount": number or null, "currency": "EUR"|"USD"|"GBP"|other ISO code, "category": one of ${CATEGORIES.join(', ')}, "confidence": "high"|"medium"|"low", "notes": string}`;
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${buffer.toString('base64')}`, detail: 'high' } },
          { type: 'text', text: `${PROMPT}\n\n${schemaHint}` },
        ],
      }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('xAI error', res.status, text.slice(0, 500));
    const err = new Error(res.status === 401 ? 'The Grok API key was rejected.' : 'Grok could not read that document. Please try again.');
    err.status = res.status === 401 ? 503 : 502;
    throw err;
  }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content || '';
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('The scan did not return any details.');
  return JSON.parse(match[0]);
}

async function callClaude(buffer, mediaType) {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'record_receipt' },
    messages: [
      { role: 'user', content: [toContentBlock(buffer, mediaType), { type: 'text', text: PROMPT }] },
    ],
  });

  const block = response.content.find((b) => b.type === 'tool_use');
  if (!block) throw new Error('The scan did not return any details.');
  return block.input;
}

export async function parseReceipt(buffer, mediaType) {
  const r = process.env.XAI_API_KEY ? await callGrok(buffer, mediaType) : await callClaude(buffer, mediaType);

  const currency = String(r.currency || 'EUR').toUpperCase();
  const amount = typeof r.total_amount === 'number' && r.total_amount >= 0 ? r.total_amount : null;
  let vat = typeof r.vat_amount === 'number' && r.vat_amount >= 0 ? r.vat_amount : null;
  if (vat !== null && amount !== null && vat > amount) vat = null; // nonsense, drop it
  const date = /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? r.date : null;

  return {
    isReceipt: r.is_receipt !== false,
    merchant: String(r.merchant || '').trim().slice(0, 120),
    date,
    amount,
    vat,
    currency,
    currencySupported: SUPPORTED_CURRENCIES.includes(currency),
    category: CATEGORIES.includes(r.category) ? r.category : 'Other',
    confidence: ['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : 'low',
    notes: String(r.notes || '').slice(0, 300),
  };
}
