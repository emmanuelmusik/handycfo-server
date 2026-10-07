import { Router } from 'express';
import { requirePaid } from '../lib/plans.js';
import { requireAuth } from '../lib/auth.js';
import { buildAuthUrl, completeAuth, verifyState, returnToFromState, disconnectDropbox } from '../lib/dropbox.js';

export const dropboxAuthRouter = Router();

const allowedOrigins = () => (process.env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim().replace(/\/$/, '')).filter(Boolean);

// The website the user is on right now (the browser tells us in the Origin
// header of the call to /start). We send them back there when Dropbox is done,
// so nobody has to configure a redirect address by hand.
function currentSite(req) {
  const origin = String(req.headers.origin || '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(origin)) return null;
  const allowed = allowedOrigins();
  return allowed.length === 0 || allowed.includes(origin) ? origin : null;
}

function backToApp(result, returnTo) {
  const base = returnTo
    || ((process.env[result === 'connected' ? 'DROPBOX_SUCCESS_REDIRECT' : 'DROPBOX_FAILURE_REDIRECT'] || '').startsWith('http')
      ? null
      : allowedOrigins()[0]);
  if (base) return `${base}/?dropbox=${result}`;
  return process.env[result === 'connected' ? 'DROPBOX_SUCCESS_REDIRECT' : 'DROPBOX_FAILURE_REDIRECT'] || '/';
}

// The app calls this (authenticated) to get the URL to open —
// in Capacitor, open it with the in-app Browser plugin so the
// user stays inside HandyCFO's UI chrome rather than bouncing to
// the system browser.
dropboxAuthRouter.get('/auth/dropbox/start', requireAuth, async (req, res) => {
  try {
    await requirePaid(req.userId, 'dropbox');
    const url = await buildAuthUrl(req.userId, currentSite(req));
    res.json({ url });
  } catch (err) {
    if (err.status === 402) return res.status(402).json({ error: err.message, ...(err.extra || {}) });
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
    return res.redirect(backToApp('failed', returnToFromState(state)));
  }

  try {
    const userId = verifyState(state);
    await completeAuth(code, userId);
    res.redirect(backToApp('connected', returnToFromState(state)));
  } catch (err) {
    console.error('dropbox callback error', err);
    res.redirect(backToApp('failed', returnToFromState(state)));
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
