import { createClient } from '@supabase/supabase-js';

// Service-role client: bypasses Row Level Security entirely, so
// every query written against this client must do its own
// ownership checks (or rely on a query that's inherently scoped,
// like "where id = :id" after you've already verified the caller
// owns that id). Never send this client's key to the frontend.
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
