import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';

type DeletedClip = {
  id: string;
  title: string;
  user_id: string;
  mime_type: string | null;
  duration_seconds: number | null;
  lms_enabled: boolean;
  deleted_at: string;
  owner_name: string;
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(secs: number | null): string {
  if (!secs || secs <= 0) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function AdminDeletedClips() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<DeletedClip[]>({
    queryKey: ['admin-deleted-clips'],
    queryFn: () => api.get('/admin/clips-recovery').then((r) => r.data.data),
  });

  const recover = useMutation({
    mutationFn: (id: string) => api.put('/admin/clips-recovery/recover', { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-deleted-clips'] }),
  });

  const permDelete = useMutation({
    mutationFn: (id: string) => api.delete('/admin/clips-recovery/permanent', { data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-deleted-clips'] }),
  });

  const items = data ?? [];

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">
          Deleted Clips
        </h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Squad Clips with a Learning link that were deleted from the library. Recover one to
          restore its embedded video, or remove it for good.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-divider bg-surface">
        <table className="w-full">
          <thead>
            <tr className="border-b border-divider bg-surface-alt">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">Clip</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">Owner</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">Length</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">Deleted</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-foreground-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-foreground-dim">Loading…</td>
              </tr>
            )}
            {!isLoading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-foreground-dim">No deleted clips</td>
              </tr>
            )}
            {items.map((clip) => (
              <tr key={clip.id} className="border-b border-divider last:border-0 hover:bg-surface-alt">
                <td className="px-4 py-3">
                  <span className="text-sm font-medium text-foreground">{clip.title}</span>
                </td>
                <td className="px-4 py-3 text-sm text-foreground-muted">{clip.owner_name}</td>
                <td className="px-4 py-3 text-sm text-foreground-muted tabular-nums">{formatDuration(clip.duration_seconds)}</td>
                <td className="px-4 py-3 text-sm text-foreground-muted">{timeAgo(clip.deleted_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => recover.mutate(clip.id)}
                      disabled={recover.isPending}
                      className="rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-hover disabled:opacity-50"
                    >
                      Recover
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Permanently delete "${clip.title}"? This can't be undone.`)) {
                          permDelete.mutate(clip.id);
                        }
                      }}
                      disabled={permDelete.isPending}
                      className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete forever
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
