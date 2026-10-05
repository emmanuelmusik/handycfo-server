import crypto from 'node:crypto';
import { supabaseAdmin } from './supabaseAdmin.js';
import { hasDropbox, uploadReceipt, getReceiptLink, deleteDropboxFile } from './dropbox.js';

// Where a receipt file goes:
//   - the user's Dropbox, if they connected it (the file never touches us)
//   - otherwise a private Supabase Storage bucket, reachable only through
//     short-lived signed links this server hands out
// The database only ever stores { provider, externalId } plus the text
// we extracted. It never holds the image itself.

const BUCKET = 'receipts';

function safeName(name) {
  return String(name || 'receipt')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'receipt';
}

export async function saveReceipt({ userId, business, fileName, buffer, mediaType }) {
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `${stamp}-${crypto.randomUUID().slice(0, 8)}-${safeName(fileName)}`;

  if (await hasDropbox(userId)) {
    const folder = safeName(business.name).replace(/_/g, ' ');
    const file = await uploadReceipt(userId, `/${folder}/${name}`, buffer);
    return { provider: 'dropbox', externalId: file.id };
  }

  const path = `${userId}/${business.id}/${name}`;
  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: mediaType, upsert: false });
  if (error) throw new Error(`Could not store the receipt: ${error.message}`);
  return { provider: 'supabase', externalId: path };
}

export async function getReceiptUrl(userId, provider, externalId) {
  if (!externalId || provider === 'none') return null;
  if (provider === 'dropbox') return getReceiptLink(userId, externalId);
  if (provider === 'supabase') {
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(externalId, 60 * 10);
    if (error) throw new Error(`Could not create a link: ${error.message}`);
    return data.signedUrl;
  }
  return null;
}

// Removes a stored receipt. For Dropbox this is only called when the user
// discards a scan we just uploaded; we do not delete their files otherwise.
export async function removeReceipt(userId, provider, externalId, { allowDropboxDelete = false } = {}) {
  if (!externalId) return;
  try {
    if (provider === 'supabase') {
      await supabaseAdmin.storage.from(BUCKET).remove([externalId]);
    } else if (provider === 'dropbox' && allowDropboxDelete) {
      await deleteDropboxFile(userId, externalId);
    }
  } catch (err) {
    console.warn('Could not remove stored receipt (continuing):', err.message);
  }
}

// Removes every file under a folder in our bucket, used when a business
// or a whole account is deleted so nothing is orphaned.
export async function removeFolder(prefix) {
  try {
    const { data: entries } = await supabaseAdmin.storage.from(BUCKET).list(prefix, { limit: 1000 });
    if (!entries?.length) return;

    const files = [];
    for (const entry of entries) {
      if (entry.id) {
        files.push(`${prefix}/${entry.name}`); // a file
      } else {
        // a sub-folder (a business folder under the user folder)
        const { data: inner } = await supabaseAdmin.storage.from(BUCKET).list(`${prefix}/${entry.name}`, { limit: 1000 });
        for (const f of inner || []) files.push(`${prefix}/${entry.name}/${f.name}`);
      }
    }
    if (files.length) await supabaseAdmin.storage.from(BUCKET).remove(files);
  } catch (err) {
    console.warn('Could not clear storage folder (continuing):', err.message);
  }
}

export function mimeFromName(fileName, fallback = 'application/octet-stream') {
  const ext = String(fileName).toLowerCase().split('.').pop();
  return ({
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf',
  })[ext] || fallback;
}

// One photo or PDF can hold several receipts, so several inbox items and
// expenses may point at the same stored file. It may only be deleted when
// nothing else still uses it.
export async function isFileInUse(externalId, { exceptInboxId = null, exceptExpenseId = null } = {}) {
  if (!externalId) return false;
  let inbox = supabaseAdmin.from('inbox_documents').select('id', { count: 'exact', head: true }).eq('receipt_external_id', externalId);
  if (exceptInboxId) inbox = inbox.neq('id', exceptInboxId);
  let expenses = supabaseAdmin.from('expenses').select('id', { count: 'exact', head: true }).eq('receipt_external_id', externalId);
  if (exceptExpenseId) expenses = expenses.neq('id', exceptExpenseId);
  const [a, b] = await Promise.all([inbox, expenses]);
  return (a.count || 0) + (b.count || 0) > 0;
}
