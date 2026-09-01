import { randomBytes } from 'crypto';
import { supabaseAdmin } from '../supabase';

/** Unique CARD-XXXXXX code. Retries on collision. */
export async function generateCardCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const suffix = randomBytes(4).toString('base64url').slice(0, 6).toUpperCase();
    const code = `CARD-${suffix}`;
    const { data: existing } = await supabaseAdmin
      .from('subscription_cards')
      .select('id')
      .eq('card_code', code)
      .maybeSingle();
    if (!existing) return code;
  }
  throw new Error('Failed to generate unique card code after 10 attempts');
}
