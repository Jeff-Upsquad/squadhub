import { supabaseAdmin } from '../supabase';

/** Full task rows only after the existing Home eligibility checks pass. */
export async function getHomeTaskCandidates(
  userId: string,
  kind: 'new' | 'focused',
  options: { includeDone?: boolean; includeReviewed?: boolean } = {},
): Promise<any[]> {
  const rows: any[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabaseAdmin.rpc('pm_home_task_candidates', {
      p_user_id: userId, p_kind: kind,
      p_include_done: options.includeDone === true,
      p_include_reviewed: options.includeReviewed === true,
    }).order('id').range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}
