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

function signState(userId) {
  const payload = JSON.stringify({ uid: userId, exp: Date.now() + 10 * 60 * 1000 });
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

// ---------- Step 1: build the "Connect Dropbox" URL ----------
export async function buildAuthUrl(userId) {
  const dbxAuth = new DropboxAuth({
    clientId: process.env.DROPBOX_APP_KEY,
    clientSecret: process.env.DROPBOX_APP_SECRET,
  });
  const state = signState(userId);
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
// Dropbox short-lived access tokens expire in ~4 hours, so most calls
// need a refresh first. The SDK handles that for us once we give it
// both tokens — it'll silently refresh and we re-encrypt/store the
// new access token if it rotates.
export async function getDropboxClientForUser(userId) {
  const { data: conn, error } = await supabaseAdmin
    .from('storage_connections')
    .select('*')
    .eq('owner_id', userId)
    .eq('provider', 'dropbox')
    .single();

  if (error || !conn) {
    throw new Error('No connected Dropbox account for this user');
  }

  const dbxAuth = new DropboxAuth({
    clientId: process.env.DROPBOX_APP_KEY,
    clientSecret: process.env.DROPBOX_APP_SECRET,
    accessToken: decrypt(conn.access_token_encrypted),
    refreshToken: conn.refresh_token_encrypted ? decrypt(conn.refresh_token_encrypted) : undefined,
  });

  return new Dropbox({ auth: dbxAuth });
}

// ---------- Disconnect ----------
export async function disconnectDropbox(userId) {
  const { data: conn } = await supabaseAdmin
    .from('storage_connections')
    .select('access_token_encrypted')
    .eq('owner_id', userId)
    .eq('provider', 'dropbox')
    .single();

  if (conn) {
    try {
      const dbxAuth = new DropboxAuth({
        clientId: process.env.DROPBOX_APP_KEY,
        clientSecret: process.env.DROPBOX_APP_SECRET,
        accessToken: decrypt(conn.access_token_encrypted),
      });
      const dbx = new Dropbox({ auth: dbxAuth });
      await dbx.authTokenRevoke(); // best-effort — don't block disconnect on this
    } catch {
      // Token may already be invalid/expired — that's fine, we're deleting it anyway.
    }
  }

  await supabaseAdmin
    .from('storage_connections')
    .delete()
    .eq('owner_id', userId)
    .eq('provider', 'dropbox');
}

// ---------- Upload a receipt into the user's App Folder ----------
export async function uploadReceipt(userId, fileName, fileBuffer) {
  const dbx = await getDropboxClientForUser(userId);
  const result = await dbx.filesUpload({
    path: `/${fileName}`, // App Folder access scopes this to HandyCFO's own folder automatically
    contents: fileBuffer,
    mode: { '.tag': 'add' },
    autorename: true,
  });
  return result.result; // includes id, path_lower, etc. — store result.id as receipt_external_id
}

// ---------- Get a temporary link to show/download a receipt ----------
export async function getReceiptLink(userId, dropboxFileId) {
  const dbx = await getDropboxClientForUser(userId);
  const result = await dbx.filesGetTemporaryLink({ path: dropboxFileId });
  return result.result.link; // expires after a few hours — fetch fresh each time it's needed
}
