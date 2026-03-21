import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';

type TrashItem = {
  id: string;
  name: string;
  deleted_at: string;
  created_by_name: string | null;
  color?: string;
  icon?: string;
  space_id?: string;
  folder_id?: string;
  spaces?: { name: string; workspace_id: string };
};

type TrashType = 'space' | 'folder' | 'list';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function TypeBadge({ type }: { type: TrashType }) {
  const colors = {
    space: 'bg-purple-50 text-purple-700',
    folder: 'bg-yellow-50 text-yellow-700',
    list: 'bg-blue-50 text-blue-700',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${colors[type]}`}>
      {type}
    </span>
  );
}

export default function AdminTrash() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | TrashType>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-trash'],
    queryFn: () => api.get('/admin/trash').then((r) => r.data.data),
  });

  const restore = useMutation({
    mutationFn: (body: { type: TrashType; id: string }) => api.put('/admin/trash/restore', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-trash'] }),
  });

  const permDelete = useMutation({
    mutationFn: (body: { type: TrashType; id: string }) => api.delete('/admin/trash/permanent', { data: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-trash'] }),
  });

  const allItems: { type: TrashType; item: TrashItem }[] = [];
  if (data) {
    data.spaces?.forEach((s: TrashItem) => allItems.push({ type: 'space', item: s }));
    data.folders?.forEach((f: TrashItem) => allItems.push({ type: 'folder', item: f }));
    data.lists?.forEach((l: TrashItem) => allItems.push({ type: 'list', item: l }));
  }

  // Sort by deleted_at descending
  allItems.sort((a, b) => new Date(b.item.deleted_at).getTime() - new Date(a.item.deleted_at).getTime());

  const filtered = filter === 'all' ? allItems : allItems.filter((i) => i.type === filter);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[#0F172B]">Trash</h1>
          <p className="mt-1 text-sm text-[#62748E]">Deleted spaces, folders, and lists. Restore or permanently delete them.</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="mb-4 flex gap-1 rounded-lg bg-white p-1 border border-[#E2E8F0] w-fit">
        {(['all', 'space', 'folder', 'list'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              filter === t ? 'bg-[#0F172B] text-white' : 'text-[#62748E] hover:text-[#0F172B]'
            }`}
          >
            {t === 'all' ? 'All' : `${t.charAt(0).toUpperCase() + t.slice(1)}s`}
            {data && (
              <span className="ml-1 opacity-60">
                ({t === 'all' ? allItems.length : allItems.filter((i) => i.type === t).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[#62748E]">Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[#62748E]">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[#62748E]">Parent</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[#62748E]">Deleted by</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[#62748E]">Deleted</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-[#62748E]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-[#999999]">Loading...</td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-[#999999]">Trash is empty</td>
              </tr>
            )}
            {filtered.map(({ type, item }) => (
              <tr key={`${type}-${item.id}`} className="border-b border-[#E2E8F0] last:border-0 hover:bg-[#F8FAFC]">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {type === 'space' && (
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold text-white"
                        style={{ backgroundColor: item.color || '#7c3aed' }}
                      >
                        {item.name?.[0]?.toUpperCase()}
                      </span>
                    )}
                    {type === 'folder' && (
                      <svg className="h-4 w-4 text-yellow-500/70" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
                      </svg>
                    )}
                    {type === 'list' && (
                      <svg className="h-4 w-4 text-[#999999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                      </svg>
                    )}
                    <span className="text-sm font-medium text-[#0F172B]">{item.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3"><TypeBadge type={type} /></td>
                <td className="px-4 py-3 text-sm text-[#62748E]">
                  {type === 'space' ? '—' : item.spaces?.name || '—'}
                </td>
                <td className="px-4 py-3 text-sm text-[#62748E]">{item.created_by_name || '—'}</td>
                <td className="px-4 py-3 text-sm text-[#62748E]">{timeAgo(item.deleted_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => restore.mutate({ type, id: item.id })}
                      disabled={restore.isPending}
                      className="rounded-md bg-[#0F172B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1D293D] disabled:opacity-50"
                    >
                      Restore
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Permanently delete "${item.name}"? This cannot be undone.`)) {
                          permDelete.mutate({ type, id: item.id });
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
