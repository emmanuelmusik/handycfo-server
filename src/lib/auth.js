import { supabaseAdmin } from './supabaseAdmin.js';

// The React/Capacitor app sends the Supabase session's access
// token as a normal Bearer header. We hand it back to Supabase to
// verify it (signature + expiry) and recover the user id — this
// avoids needing to manage JWT secrets/rotation ourselves.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.userId = data.user.id;
  req.userEmail = data.user.email;
  next();
}
