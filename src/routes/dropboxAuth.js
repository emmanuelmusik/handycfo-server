import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { buildAuthUrl, completeAuth, verifyState, disconnectDropbox } from '../lib/dropbox.js';

export const dropboxAuthRouter = Router();

// The app calls this (authenticated) to get the URL to open —
// in Capacitor, open it with the in-app Browser plugin so the
// user stays inside HandyCFO's UI chrome rather than bouncing to
// the system browser.
dropboxAuthRouter.get('/auth/dropbox/start', requireAuth, async (req, res) => {
  try {
    const url = await buildAuthUrl(req.userId);
    res.json({ url });
  } catch (err) {
    console.error('dropbox start error', err);
    res.status(500).json({ error: 'Could not start Dropbox connection' });
  }
});

// Dropbox redirects the browser here after the user approves —
// this request is NOT authenticated in the normal sense (no
// bearer token available in a browser redirect), which is exactly
// why buildAuthUrl signed the user id into `state`.
dropboxAuthRouter.get('/auth/dropbox/callback', async (req, res) => {
  const { code, state, error: dropboxError } = req.query;

  if (dropboxError) {
    return res.redirect(process.env.DROPBOX_FAILURE_REDIRECT);
  }

  try {
    const userId = verifyState(state);
    await completeAuth(code, userId);
    res.redirect(process.env.DROPBOX_SUCCESS_REDIRECT);
  } catch (err) {
    console.error('dropbox callback error', err);
    res.redirect(process.env.DROPBOX_FAILURE_REDIRECT);
  }
});

dropboxAuthRouter.post('/auth/dropbox/disconnect', requireAuth, async (req, res) => {
  try {
    await disconnectDropbox(req.userId);
    res.json({ disconnected: true });
  } catch (err) {
    console.error('dropbox disconnect error', err);
    res.status(500).json({ error: 'Could not disconnect Dropbox' });
  }
});
