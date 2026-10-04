import { supabaseAdmin } from './supabaseAdmin.js';

// The server uses the service role key, which bypasses Row Level
// Security. That means every route has to prove the caller owns what
// they are touching. These helpers do that in one place so no route
// can forget it. They throw an error with a `status` the route handler
// turns into the HTTP response.

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export async function getOwnedBusiness(userId, businessId) {
  if (!businessId) throw httpError(400, 'Missing businessId');
  const { data, error } = await supabaseAdmin
    .from('businesses')
    .select('*')
    .eq('id', businessId)
    .eq('owner_id', userId)
    .maybeSingle();
  if (error) throw httpError(500, 'Could not load the business');
  if (!data) throw httpError(404, 'Business not found');
  return data;
}

export async function getOwnedContact(userId, contactId) {
  if (!contactId) throw httpError(400, 'Missing contactId');
  const { data, error } = await supabaseAdmin
    .from('contacts')
    .select('*')
    .eq('id', contactId)
    .eq('owner_id', userId)
    .maybeSingle();
  if (error) throw httpError(500, 'Could not load the contact');
  if (!data) throw httpError(404, 'Contact not found');
  return data;
}

export async function getOwnedInboxDoc(userId, docId) {
  const { data, error } = await supabaseAdmin
    .from('inbox_documents')
    .select('*, businesses!inner(owner_id)')
    .eq('id', docId)
    .eq('businesses.owner_id', userId)
    .maybeSingle();
  if (error) throw httpError(500, 'Could not load the document');
  if (!data) throw httpError(404, 'Document not found');
  return data;
}

export async function getOwnedExpense(userId, expenseId) {
  const { data, error } = await supabaseAdmin
    .from('expenses')
    .select('*, businesses!inner(owner_id)')
    .eq('id', expenseId)
    .eq('businesses.owner_id', userId)
    .maybeSingle();
  if (error) throw httpError(500, 'Could not load the expense');
  if (!data) throw httpError(404, 'Expense not found');
  return data;
}

export async function getOwnedInvoice(userId, invoiceId) {
  const { data, error } = await supabaseAdmin
    .from('invoices')
    .select('*, businesses!inner(owner_id, name)')
    .eq('id', invoiceId)
    .eq('businesses.owner_id', userId)
    .maybeSingle();
  if (error) throw httpError(500, 'Could not load the invoice');
  if (!data) throw httpError(404, 'Invoice not found');
  return data;
}

// Wraps an async route handler so thrown errors become JSON responses
// instead of unhandled rejections (Express 4 does not catch these).
export function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(`${req.method} ${req.path} failed:`, err);
      res.status(status).json({ error: status >= 500 && !err.status ? 'Something went wrong' : err.message });
    }
  };
}

export { httpError };
