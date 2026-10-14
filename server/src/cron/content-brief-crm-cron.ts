import { supabaseAdmin } from '../supabase';
import { normalizeStoredPhone } from '@squadhub/shared';

let running = false;
/** CRM shares this Supabase project. Calls its server-only RPC without copying
 * CRM internals into Hub; durable rows survive a process or deployment failure. */
export async function processContentBriefCrmOutbox(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { data, error } = await supabaseAdmin.from('service_brief_crm_outbox')
      .select('card_id,payload,attempts').is('delivered_at', null)
      .lte('next_attempt_at', new Date().toISOString()).order('created_at').limit(25);
    if (error) throw error;
    for (const row of data ?? []) {
      const payload = { ...row.payload, p_phone_e164: normalizeStoredPhone(row.payload.p_phone_e164 ?? '') };
      const delivered = await supabaseAdmin.rpc('crm_record_content_brief', payload);
      const attempts = row.attempts + 1;
      const patch = delivered.error ? {
        attempts, last_error: delivered.error.message.slice(0, 500),
        next_attempt_at: new Date(Date.now() + Math.min(60, 2 ** Math.min(attempts, 6)) * 60_000).toISOString(),
      } : { attempts, delivered_at: new Date().toISOString(), crm_lead_id: delivered.data, last_error: null };
      // An edit can enqueue a newer brief while this RPC is in flight. Leave
      // that version pending rather than acknowledging the older payload.
      const updated = await supabaseAdmin.from('service_brief_crm_outbox').update(patch)
        .eq('card_id', row.card_id).eq('payload', JSON.stringify(row.payload));
      if (updated.error) throw updated.error;
    }
  } finally { running = false; }
}

export function startContentBriefCrmCron(): void {
  const tick = () => { void processContentBriefCrmOutbox().catch((e) => console.error('[content-brief-crm] retry failed:', e.message)); };
  tick();
  setInterval(tick, 60_000).unref();
}
