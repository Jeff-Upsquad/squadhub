// Creates (or reuses) the "SquadBot Build Agent" service user used to
// attribute build-agent task comments + activity, and prints its UUID for
// AGENT_USER_ID. Run: npx tsx tools/create-build-agent-user.ts
//
// Mirrors the normal signup path (auth user + public.users row) so every FK
// and renderer expectation holds. The user never logs in.
import dotenv from 'dotenv';
import path from 'path';
import { supabaseAdmin } from '../src/supabase';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const EMAIL = 'build-agent@squadhub.in';
const DISPLAY_NAME = 'SquadBot Build Agent';

async function main() {
  // Reuse an existing auth user with this email if present.
  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('id, email, display_name')
    .eq('email', EMAIL)
    .maybeSingle();

  if (existing) {
    console.log(existing.id);
    return;
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: EMAIL,
    email_confirm: true,
    email_generate_token_signed_url: false,
    user_metadata: { display_name: DISPLAY_NAME },
  });
  if (authError || !authData?.user) {
    console.error('Failed to create auth user:', authError?.message || 'unknown');
    process.exit(1);
  }

  const { error: dbError } = await supabaseAdmin.from('users').insert({
    id: authData.user.id,
    email: EMAIL,
    display_name: DISPLAY_NAME,
    status: 'active',
    user_type: 'internal',
  });
  if (dbError) {
    console.error('Failed to insert users row:', dbError.message);
    process.exit(1);
  }

  console.log(authData.user.id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
