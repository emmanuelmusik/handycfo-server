import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { getOwnedBusiness, route, httpError } from '../lib/ownership.js';
import { disconnectDropbox } from '../lib/dropbox.js';
import { removeFolder } from '../lib/storage.js';

export const accountRouter = Router();
accountRouter.use(requireAuth);

// Delete one business and everything in it.
accountRouter.delete('/businesses/:id', route(async (req, res) => {
  const biz = await getOwnedBusiness(req.userId, req.params.id);
  await removeFolder(`${req.userId}/${biz.id}`);
  const { error } = await supabaseAdmin.from('businesses').delete().eq('id', biz.id).eq('owner_id', req.userId);
  if (error) throw new Error(error.message);
  res.json({ deleted: true });
}));

// Permanently delete the signed-in user's account and all their data.
// The caller must type their email address as confirmation.
accountRouter.post('/account/delete', route(async (req, res) => {
  const typed = String(req.body?.confirmEmail || '').trim().toLowerCase();
  if (!typed || typed !== String(req.userEmail || '').toLowerCase()) {
    throw httpError(400, 'Type your account email exactly to confirm.');
  }

  // Best effort: neither failing should block the deletion itself.
  try { await disconnectDropbox(req.userId); } catch (e) { console.warn('dropbox revoke failed:', e.message); }
  await removeFolder(req.userId);

  // Every table cascades from auth.users, so this removes it all.
  const { error } = await supabaseAdmin.auth.admin.deleteUser(req.userId);
  if (error) throw new Error(`Could not delete the account: ${error.message}`);
  res.json({ deleted: true });
}));
