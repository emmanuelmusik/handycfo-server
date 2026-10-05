import crypto from 'node:crypto';
import { Dropbox, DropboxAuth } from 'dropbox';
import { encrypt, decrypt } from './crypto.js';
import { supabaseAdmin } from './supabaseAdmin.js';

// ---------- OAuth "state" param, signed instead of stored ----------
// Railway can run multiple instances of this service, so we can't
// rely on an in-memory map surviving between the /start and
// /callback requests — they might hit different instances. Instead
// the state param carries the user id itself, HMAC-signed so it
// can't be forged, with a short expiry baked in.

function signState(userId, returnTo) {
  const payload = JSON.stringify({ uid: userId, ret: returnTo || null, exp: Date.now() + 10 * 60 * 1000 });
  const payloadB64 = Buffer.from(payload).toString('base64url');
  const sig = crypto
    .createHmac('sha256', process.env.TOKEN_ENCRYPTION_KEY)
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifyState(state) {
  const [payloadB64, sig] = String(state).split('.');
  if (!payloadB64 || !sig) throw new Error('Malformed state');
  const expectedSig = crypto
    .createHmac('sha256', process.env.TOKEN_ENCRYPTION_KEY)
    .update(payloadB64)
    .digest('base64url');
  if (sig !== expectedSig) throw new Error('State signature mismatch');
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  if (Date.now() > payload.exp) throw new Error('State expired — please try connecting again');
  return payload.uid;
}

// Reads the signed state without requiring it to be fresh, only to learn
// which site the user started from (so we can send them back even on failure).
// The value is only trusted if the signature is valid.
export function returnToFromState(state) {
  try {
    const [payloadB64, sig] = String(state).split('.');
    const expectedSig = crypto.createHmac('sha256', process.env.TOKEN_ENCRYPTION_KEY).update(payloadB64).digest('base64url');
    if (!payloadB64 || sig !== expectedSig) return null;
    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString()).ret || null;
  } catch {
    return null;
  }
}

// ---------- Step 1: build the "Connect Dropbox" URL ----------
export async function buildAuthUrl(userId, returnTo) {
  const dbxAuth = new DropboxAuth({
    clientId: process.env.DROPBOX_APP_KEY,
    clientSecret: process.env.DROPBOX_APP_SECRET,
  });
  const state = signState(userId, returnTo);
  const url = await dbxAuth.getAuthenticationUrl(
    process.env.DROPBOX_REDIRECT_URI,
    state,
    'code',
    'offline',   // token_access_type: 'offline' gets us a refresh token
    undefined,
    'none',
    false
  );
  return url.toString();
}

// ---------- Step 2: exchange the ?code= for tokens, store them ----------
export async function completeAuth(code, userId) {
  const dbxAuth = new DropboxAuth({
    clientId: process.env.DROPBOX_APP_KEY,
    clientSecret: process.env.DROPBOX_APP_SECRET,
  });
  const tokenResponse = await dbxAuth.getAccessTokenFromCode(
    process.env.DROPBOX_REDIRECT_URI,
    code
  );
  const { access_token, refresh_token } = tokenResponse.result;

  dbxAuth.setAccessToken(access_token);
  const dbx = new Dropbox({ auth: dbxAuth });
  const account = await dbx.usersGetCurrentAccount();

  await supabaseAdmin
    .from('storage_connections')
    .upsert(
      {
        owner_id: userId,
        provider: 'dropbox',
        account_email: account.result.email,
        access_token_encrypted: encrypt(access_token),
        refresh_token_encrypted: refresh_token ? encrypt(refresh_token) : null,
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'owner_id,provider' }
    );

  return account.result.email;
}

// ---------- Step 3: get a ready-to-use client for a user later ----------
// Dropbox access tokens expire after about 4 hours. The SDK only
// auto-refreshes when it knows the expiry time, and we don't store
// one, so we refresh explicitly every time we build a client. That is
// one extra small request per operation, which is fine at this volume
// and means a connection never silently goes stale.
export async function getDropboxClientForUser(userId) {
  const { data: conn, error } = await supabaseAdmin
    .from('storage_connections')
    .select('*')
    .eq('owner_id', userId)
    .eq('provider', 'dropbox')
    .maybeSingle();

  if (error || !conn) {
    throw new Error('No connected Dropbox account for this user');
  }

  const dbxAuth = new DropboxAuth({
    clientId: process.env.DROPBOX_APP_KEY,
    clientSecret: process.env.DROPBOX_APP_SECRET,
    accessToken: decrypt(conn.access_token_encrypted),
    refreshToken: conn.refresh_token_encrypted ? decrypt(conn.refresh_token_encrypted) : undefined,
  });

  if (conn.refresh_token_encrypted) {
    await dbxAuth.refreshAccessToken();
  }

  return new Dropbox({ auth: dbxAuth });
}

export async function hasDropbox(userId) {
  const { data } = await supabaseAdmin
    .from('storage_connections')
    .select('id')
    .eq('owner_id', userId)
    .eq('provider', 'dropbox')
    .maybeSingle();
  return !!data;
}

// ---------- Disconnect ----------
export async function disconnectDropbox(userId) {
  const { data: conn } = await supabaseAdmin
    .from('storage_connections')
    .select('access_token_encrypted')
    .eq('owner_id', userId)
    .eq('provider', 'dropbox')
    .maybeSingle();

  if (conn) {
    try {
      const dbxAuth = new DropboxAuth({
        clientId: process.env.DROPBOX_APP_KEY,
        clientSecret: process.env.DROPBOX_APP_SECRET,
        accessToken: decrypt(conn.access_token_encrypted),
      });
      const dbx = new Dropbox({ auth: dbxAuth });
      await dbx.authTokenRevoke(); // best-effort, don't block disconnect on this
    } catch {
      // Token may already be expired or revoked; we are deleting it anyway.
    }
  }

  await supabaseAdmin
    .from('storage_connections')
    .delete()
    .eq('owner_id', userId)
    .eq('provider', 'dropbox');
}

// ---------- Upload a receipt into the user's App Folder ----------
// `path` is relative to the app folder, e.g. "/Sweet Candles/2026-10-04-receipt.jpg".
// Dropbox creates missing folders automatically.
export async function uploadReceipt(userId, path, fileBuffer) {
  const dbx = await getDropboxClientForUser(userId);
  const result = await dbx.filesUpload({
    path,
    contents: fileBuffer,
    mode: { '.tag': 'add' },
    autorename: true,
  });
  return result.result; // result.id is what we store as receipt_external_id
}

// ---------- Get a temporary link to show/download a receipt ----------
export async function getReceiptLink(userId, dropboxFileId) {
  const dbx = await getDropboxClientForUser(userId);
  const result = await dbx.filesGetTemporaryLink({ path: dropboxFileId });
  return result.result.link; // expires after a few hours, so fetch fresh each time
}

// Used only when the user discards a scan that we just uploaded. We never
// delete files from someone's Dropbox otherwise.
export async function deleteDropboxFile(userId, dropboxFileId) {
  const dbx = await getDropboxClientForUser(userId);
  await dbx.filesDeleteV2({ path: dropboxFileId });
}
