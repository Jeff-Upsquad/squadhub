import { supabaseAdmin } from '../supabase';

/** All tasks worked by this user, newest first, including older history. */
export async function getUserWorkedTaskIds(userId: string): Promise<string[]> {
  const ids = new Set<string>();
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('task_time_entries')
      .select('task_id')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    for (const entry of data ?? []) {
      if (entry.task_id) ids.add(entry.task_id);
    }
    if (!data || data.length < pageSize) break;
  }
  return [...ids];
}
