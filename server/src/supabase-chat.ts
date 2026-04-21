// Squad Chat tables (chat_*) aren't in the generated Database type used by
// the typed Supabase client. Rather than regenerating types (a separate
// pipeline), this file re-exports the admin client as `any` so chat routes
// can query the new tables without compile-time pain. Runtime is unaffected —
// server owns validation via Zod at every boundary.
import { supabaseAdmin as _admin } from './supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabaseAdmin: any = _admin;
