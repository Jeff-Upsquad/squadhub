'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { LmsItem, LmsItemStatus, LmsItemKind, LmsTrack, LmsCategory } from '@squadhub/shared';

const STATUS_COLORS: Record<LmsItemStatus, string> = {
  draft: 'bg-canvas text-foreground-muted',
  published: 'bg-emerald-50 text-emerald-700',
  archived: 'bg-amber-50 text-amber-700',
};

const KIND_LABELS: Record<LmsItemKind, string> = {
  post: 'Post',
  course: 'Course',
};

export default function AdminLmsLibrary() {
  const router = useRouter();
  const qc = useQueryClient();
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [kindFilter, setKindFilter] = useState<LmsItemKind | ''>('');
  const [statusFilter, setStatusFilter] = useState<LmsItemStatus | ''>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [trackFilter, setTrackFilter] = useState<LmsTrack | ''>('');
  const [showGen, setShowGen] = useState(false);
  const [selectedSpec, setSelectedSpec] = useState('');

  const queryParams = new URLSearchParams();
  if (kindFilter) queryParams.set('kind', kindFilter);
  if (statusFilter) queryParams.set('status', statusFilter);
  if (categoryFilter) queryParams.set('category_id', categoryFilter);
  if (trackFilter) queryParams.set('track', trackFilter);

  const { data: itemsRes } = useQuery({
    queryKey: ['lms-items', kindFilter, statusFilter, categoryFilter, trackFilter],
    queryFn: () => api.get(`/admin/lms/items?${queryParams.toString()}`).then((r) => r.data),
  });
  const items: LmsItem[] = itemsRes?.data || [];

  const { data: catRes } = useQuery({
    queryKey: ['lms-categories'],
    queryFn: () => api.get('/admin/lms/categories').then((r) => r.data),
  });
  const categories: LmsCategory[] = catRes?.data || [];

  // SOP generator specs (lazy — only when the modal opens).
  const { data: specsRes } = useQuery({
    queryKey: ['sop-specs'],
    queryFn: () => api.get('/admin/lms/sop-specs').then((r) => r.data),
    enabled: showGen,
  });
  const specs: { file: string; title: string }[] = specsRes?.data || [];

  const generate = useMutation({
    mutationFn: (spec: string) => api.post('/admin/lms/generate-sop', { spec }).then((r) => r.data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['lms-items'] });
      setShowGen(false);
      if (res?.data?.itemId) router.push(`/admin/learning/${res.data.itemId}`);
    },
    onError: (e: any) => {
      const d = e?.response?.data;
      alert((d?.error || 'Generation failed') + (d?.detail ? `\n\n${d.detail}` : ''));
    },
  });

  const createItem = useMutation({
    mutationFn: (body: any) => api.post('/admin/lms/items', body).then((r) => r.data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['lms-items'] });
      setShowNewMenu(false);
      if (res?.data?.id) router.push(`/admin/learning/${res.data.id}`);
    },
    onError: (e: any) => alert(e?.response?.data?.error || 'Failed to create'),
  });

  const deleteItem = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/lms/items/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms-items'] }),
  });

  function onNew(kind: LmsItemKind, track: LmsTrack = 'learning') {
    const label = track === 'sop' ? 'guide' : kind;
    const title = prompt(`New ${label} title`);
    if (!title) return;
    createItem.mutate({ kind, track, title });
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Learning Library</h1>
          <p className="mt-1 text-sm text-foreground-muted">Publish training posts and courses to internal team, clients and partners.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/learning/categories"
            className="rounded-lg border border-divider bg-surface px-4 py-2 text-sm font-medium text-foreground-muted hover:bg-surface-alt"
          >
            Categories
          </Link>
          <button
            onClick={() => setShowGen(true)}
            className="rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
            title="Auto-generate a Systems & Processes guide from a screen"
          >
            ✨ Auto-generate
          </button>
          <div className="relative">
            <button
              onClick={() => setShowNewMenu((v) => !v)}
              className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-hover"
            >
              + New content
            </button>
            {showNewMenu && (
              <div className="absolute right-0 top-full z-10 mt-1 w-52 rounded-lg border border-divider bg-surface shadow-lg">
                <button
                  onClick={() => onNew('post')}
                  className="flex w-full flex-col px-3 py-2 text-left hover:bg-surface-alt"
                >
                  <span className="text-sm font-medium text-foreground">Post</span>
                  <span className="text-[11px] text-foreground-muted">Self-contained update</span>
                </button>
                <button
                  onClick={() => onNew('course')}
                  className="flex w-full flex-col px-3 py-2 text-left hover:bg-surface-alt"
                >
                  <span className="text-sm font-medium text-foreground">Course</span>
                  <span className="text-[11px] text-foreground-muted">Multi-lesson journey</span>
                </button>
                <div className="my-1 border-t border-divider" />
                <button
                  onClick={() => onNew('post', 'sop')}
                  className="flex w-full flex-col px-3 py-2 text-left hover:bg-surface-alt"
                >
                  <span className="text-sm font-medium text-foreground">SOP / Guide</span>
                  <span className="text-[11px] text-foreground-muted">Systems &amp; Processes how-to</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterChip active={!trackFilter} onClick={() => setTrackFilter('')} label="All tracks" />
        <FilterChip active={trackFilter === 'learning'} onClick={() => setTrackFilter('learning')} label="Learning" />
        <FilterChip active={trackFilter === 'sop'} onClick={() => setTrackFilter('sop')} label="Systems & Processes" />
        <span className="mx-1 h-4 w-px bg-well" />
        <FilterChip active={!kindFilter} onClick={() => setKindFilter('')} label="All kinds" />
        <FilterChip active={kindFilter === 'post'} onClick={() => setKindFilter('post')} label="Posts" />
        <FilterChip active={kindFilter === 'course'} onClick={() => setKindFilter('course')} label="Courses" />
        <span className="mx-1 h-4 w-px bg-well" />
        <FilterChip active={!statusFilter} onClick={() => setStatusFilter('')} label="All statuses" />
        <FilterChip active={statusFilter === 'draft'} onClick={() => setStatusFilter('draft')} label="Draft" />
        <FilterChip active={statusFilter === 'published'} onClick={() => setStatusFilter('published')} label="Published" />
        {categories.length > 0 && (
          <>
            <span className="mx-1 h-4 w-px bg-well" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-full border border-divider bg-surface px-3 py-1 text-[12px] text-foreground-muted focus:border-ink focus:outline-none"
            >
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-divider-strong bg-surface p-10 text-center">
          <p className="text-sm text-foreground-muted">No learning content yet.</p>
          <p className="mt-1 text-[12px] text-foreground-dim">Click "New content" to get started.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-divider bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt">
              <tr>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Title</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Kind</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Status</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Audience</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Assigned</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Updated</th>
                <th className="w-1 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-surface-alt">
                  <td className="px-4 py-3">
                    <Link href={`/admin/learning/${item.id}`} className="block">
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        {item.title}
                        {item.track === 'sop' && (
                          <span className="rounded-full bg-indigo-50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-indigo-700">
                            SOP
                          </span>
                        )}
                      </div>
                      {item.category && (
                        <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-foreground-muted">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.category.color }} />
                          {item.category.name}
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">{KIND_LABELS[item.kind]}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[item.status]}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">
                    {(item.audience_types || []).length > 0 ? (item.audience_types || []).join(', ') : <span className="text-foreground-dim">—</span>}
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">{item.assignment_count ?? 0}</td>
                  <td className="px-4 py-3 text-foreground-muted">{new Date(item.updated_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => { if (confirm(`Delete "${item.title}"?`)) deleteItem.mutate(item.id); }}
                      className="text-[12px] text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showGen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !generate.isPending && setShowGen(false)}>
          <div className="w-full max-w-md rounded-xl border border-divider bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-foreground">✨ Auto-generate a guide</h2>
            <p className="mt-1 text-[13px] text-foreground-muted">
              Pick a screen recipe. We&apos;ll open the app, capture screenshots with markings, and create a draft SOP for you to review and publish.
            </p>

            <label className="mt-4 block text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Screen recipe</label>
            <select
              value={selectedSpec || specs[0]?.file || ''}
              onChange={(e) => setSelectedSpec(e.target.value)}
              disabled={generate.isPending || specs.length === 0}
              className="mt-1 w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm focus:border-ink focus:outline-none disabled:opacity-60"
            >
              {specs.length === 0 ? (
                <option value="">No recipes found (tools/sop_specs)</option>
              ) : (
                specs.map((s) => <option key={s.file} value={s.file}>{s.title}</option>)
              )}
            </select>

            {generate.isPending ? (
              <div className="mt-4 flex items-center gap-2 rounded-md bg-indigo-50 px-3 py-2.5 text-[13px] text-indigo-800">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-700" />
                Generating… this takes ~30–60s (opening the app, capturing screens).
              </div>
            ) : (
              <div className="mt-5 flex justify-end gap-2">
                <button onClick={() => setShowGen(false)} className="rounded-lg border border-divider bg-surface px-4 py-2 text-sm text-foreground-muted hover:bg-surface-alt">
                  Cancel
                </button>
                <button
                  onClick={() => generate.mutate(selectedSpec || specs[0]?.file)}
                  disabled={specs.length === 0}
                  className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-hover disabled:opacity-50"
                >
                  Generate draft
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-[12px] transition ${
        active ? 'bg-ink text-white' : 'border border-divider bg-surface text-foreground-muted hover:bg-surface-alt'
      }`}
    >
      {label}
    </button>
  );
}
