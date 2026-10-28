import { supabaseAdmin } from '../supabase';

type Kind = 'new' | 'focused' | 'assigned' | 'worked';
type Entry = { digest: string; rows: any[]; bytes: number };
const snapshots = new Map<string, Entry>();
let storedBytes = 0;
const maxBytes = 16 * 1024 * 1024;

/** Revalidate every request in Postgres; reuse bodies only after its fresh hash matches. */
export async function getHomeTaskCandidates(
  userId: string, kind: Kind,
  options: { includeDone?: boolean; includeReviewed?: boolean; taskIds?: string[] } = {},
): Promise<any[]> {
  const ids = kind === 'worked' ? [...new Set(options.taskIds ?? [])].sort() : null;
  const key = JSON.stringify([userId, kind, options.includeDone === true, options.includeReviewed === true, ids]);
  const cached = snapshots.get(key);
  const { data, error } = await supabaseAdmin.rpc('pm_home_task_snapshot', {
    p_user_id: userId, p_kind: kind,
    p_include_done: options.includeDone === true,
    p_include_reviewed: options.includeReviewed === true,
    p_task_ids: ids, p_known_digest: cached?.digest ?? null,
  });
  if (error) throw error;
  if (!data || typeof data.digest !== 'string' || !/^[a-f0-9]{64}$/.test(data.digest)) {
    throw new Error('Invalid Home task snapshot');
  }
  if (data.rows === null) {
    if (!cached || cached.digest !== data.digest) throw new Error('Home task snapshot body unavailable');
    if (snapshots.get(key) === cached) { snapshots.delete(key); snapshots.set(key, cached); }
    return structuredClone(cached.rows);
  }
  if (!Array.isArray(data.rows)) throw new Error('Invalid Home task snapshot rows');
  const rows = data.rows as any[];
  const bytes = Buffer.byteLength(JSON.stringify(rows)) + Buffer.byteLength(key);
  if (bytes <= maxBytes) {
    const prior = snapshots.get(key);
    if (prior) { storedBytes -= prior.bytes; snapshots.delete(key); }
    while (snapshots.size >= 128 || storedBytes + bytes > maxBytes) {
      const oldest = snapshots.keys().next().value;
      if (oldest === undefined) break;
      storedBytes -= snapshots.get(oldest)!.bytes; snapshots.delete(oldest);
    }
    snapshots.set(key, { digest: data.digest, rows: structuredClone(rows), bytes });
    storedBytes += bytes;
  }
  return rows;
}
