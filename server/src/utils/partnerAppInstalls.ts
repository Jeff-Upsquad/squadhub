import { supabaseAdmin } from '../supabase';

export interface PartnerAppSighting {
  platform: 'ios' | 'android';
  version_name?: string;
  version_code?: number;
}

/**
 * Record that `userId` is using the native partner app right now. Upserts the
 * one partner_app_installs row per user. first_seen_at is left out of the
 * payload so it defaults on insert and is never overwritten afterwards; the
 * version columns are only sent when known, so a push-token registration from
 * an older build doesn't blank a version a newer check-in already reported.
 */
export async function recordPartnerAppSighting(userId: string, sighting: PartnerAppSighting): Promise<void> {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    user_id: userId,
    platform: sighting.platform,
    last_seen_at: now,
    updated_at: now,
  };
  if (sighting.version_name !== undefined) row.version_name = sighting.version_name;
  if (sighting.version_code !== undefined) row.version_code = sighting.version_code;

  const { error } = await supabaseAdmin
    .from('partner_app_installs')
    .upsert(row, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}
