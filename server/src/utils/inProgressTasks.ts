import { supabaseAdmin } from '../supabase';

/** Latest saved work per task for this user, newest first, including older history. */
export async function getUserWorkedTaskHistory(userId: string): Promise<Map<string, string>> {
  const history = new Map<string, string>();
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('task_time_entries')
      .select('task_id, started_at')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    for (const entry of data ?? []) {
      if (entry.task_id && !history.has(entry.task_id)) history.set(entry.task_id, entry.started_at);
    }
    if (!data || data.length < pageSize) break;
  }
  return history;
}
