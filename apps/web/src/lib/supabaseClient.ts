import { createClient } from '@supabase/supabase-js';

// Publishable key only. The frontend never holds the Secret key; all writes
// to enrollments/registration data go through apps/api, which validates the
// caller's JWT and role before calling the RPC functions.
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
