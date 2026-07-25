import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

// Builds a request-scoped client that acts as the calling user (via their JWT),
// so RLS and auth.uid() inside RPCs/table reads resolve to that user. This is
// the only Supabase client the running server uses — every request, including
// token verification and profile lookup in middleware/auth.ts, goes through
// this client with the Publishable key + the caller's own access token, so
// RLS stays in force end to end.
//
// The Secret key is deliberately not wired up here: it is only ever read by
// scripts/seedDemoUsers.ts, which builds its own client directly.
export function createUserScopedClient(accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}
