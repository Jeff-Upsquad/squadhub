import { createClient } from '@supabase/supabase-js';
import { config } from './config';

// Admin client — bypasses RLS, used for server-side database operations
export const supabaseAdmin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Separate client for auth verification only (avoids contaminating admin client state)
export const supabaseAuth = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  global: {
    fetch: (input, init) => fetch(input, {
      ...init,
      signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(init?.signal ? [init.signal] : [])]),
    }),
  },
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Public client — respects RLS, used when acting on behalf of a user
// Auth operations must use a fresh client: even with persistSession=false the
// SDK retains a session in memory and can refresh it before an explicit refresh.
export function createAuthClient() {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

export const supabase = createAuthClient();

// Create a client scoped to a specific user's JWT (for RLS)
export function supabaseForUser(accessToken: string) {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
