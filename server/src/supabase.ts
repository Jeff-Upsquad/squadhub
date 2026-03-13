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
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Public client — respects RLS, used when acting on behalf of a user
export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

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
