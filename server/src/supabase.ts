import { createClient } from '@supabase/supabase-js';
import { config } from './config';

// Admin client — bypasses RLS, used for server-side operations
export const supabaseAdmin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

// Public client — respects RLS, used when acting on behalf of a user
export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

// Create a client scoped to a specific user's JWT (for RLS)
export function supabaseForUser(accessToken: string) {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
