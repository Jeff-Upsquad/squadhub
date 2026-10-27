import { supabaseAdmin } from '../supabase';
/** Admin-only delivery feedback. Keep operational failures visible while a
 * business requirement waits for an automatic retry. */
export async function requirementDeliveryStatus(table: 'subscription_cards' | 'job_cards', ids: string[]) {
    const result = new Map<string, {
        auto_broadcast_status: string;
        auto_broadcast_error: string | null;
    }>();
    if (!ids.length)
        return result;
    const { data, error } = await supabaseAdmin.from('requirement_delivery_queue')
        .select('card_id,completed_at,last_error').eq('card_table', table).in('card_id', ids);
    if (error)
        throw error;
    for (const row of data ?? [])
        result.set(row.card_id, {
            auto_broadcast_status: row.completed_at ? 'delivered' : row.last_error ? 'retrying' : 'pending',
            auto_broadcast_error: row.last_error,
        });
    return result;
}
