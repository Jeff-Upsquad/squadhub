'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { LmsItem, LmsItemStatus, LmsItemKind, LmsTrack, LmsCategory } from '@squadhub/shared';
import ShareModal from '../../components/lms/ShareModal';

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
  const [showNew, setShowNew] = useState(false);
  const [kindFilter, setKindFilter] = useState<LmsItemKind | ''>('');
  const [statusFilter, setStatusFilter] = useState<LmsItemStatus | ''>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [trackFilter, setTrackFilter] = useState<LmsTrack | ''>('');
  const [showGen, setShowGen] = useState(false);
  const [selectedSpec, setSelectedSpec] = useState('');
  // Bulk "add posts to a course" selection. Only draft posts are selectable —
  // moving a post into a course deletes the standalone post, which would drop a
  // published post's assignments, so those must be unpublished first.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showAddToCourse, setShowAddToCourse] = useState(false);
  const [shareItem, setShareItem] = useState<LmsItem | null>(null);

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

  // A post can be moved into a course only while it's a draft (see note above).
  const isSelectable = (item: LmsItem) => item.kind === 'post' && item.status === 'draft';
  const selectableIds = items.filter(isSelectable).map((i) => i.id);
  const selectedCount = selectedIds.size;
  const allSelectableChecked = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) => {
      if (selectableIds.length > 0 && selectableIds.every((id) => prev.has(id))) return new Set();
      return new Set(selectableIds);
    });
  }

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
      setShowNew(false);
      if (res?.data?.id) router.push(`/admin/learning/${res.data.id}`);
    },
    onError: (e: any) => alert(e?.response?.data?.error || 'Failed to create'),
  });

  const deleteItem = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/lms/items/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms-items'] }),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Learning Library</h1>
          <p className="mt-1 text-sm text-foreground-muted">Publish training posts and courses to internal team, clients and partners.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/learning/review"
            className="rounded-lg border border-divider bg-surface px-4 py-2 text-sm font-medium text-foreground-muted hover:bg-surface-alt"
          >
            Review queue
          </Link>
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
          <button
            onClick={() => setShowNew(true)}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-hover"
          >
            + New content
          </button>
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
                <th className="w-1 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelectableChecked}
                    onChange={toggleAll}
                    disabled={selectableIds.length === 0}
                    title="Select all draft posts"
                    aria-label="Select all draft posts"
                    className="h-4 w-4 rounded border-divider-strong accent-[#0F172B] disabled:opacity-40"
                  />
                </th>
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
                <tr key={item.id} className={selectedIds.has(item.id) ? 'bg-indigo-50/60' : 'hover:bg-surface-alt'}>
                  <td className="px-4 py-3 align-top">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleOne(item.id)}
                      disabled={!isSelectable(item)}
                      title={
                        item.kind !== 'post'
                          ? 'Only posts can be added to a course'
                          : item.status !== 'draft'
                            ? 'Unpublish this post to move it into a course'
                            : 'Select to add to a course'
                      }
                      aria-label={`Select ${item.title}`}
                      className="mt-0.5 h-4 w-4 rounded border-divider-strong accent-[#0F172B] disabled:opacity-30"
                    />
                  </td>
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
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setShareItem(item)}
                        className="text-[12px] text-foreground-muted hover:text-foreground hover:underline"
                      >
                        Share
                      </button>
                      <button
                        onClick={() => { if (confirm(`Delete "${item.title}"?`)) deleteItem.mutate(item.id); }}
                        className="text-[12px] text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
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

      {showNew && (
        <NewContentModal
          creating={createItem.isPending}
          onCreate={(body) => createItem.mutate(body)}
          onClose={() => !createItem.isPending && setShowNew(false)}
        />
      )}

      {/* Bulk action bar — appears once draft posts are selected */}
      {selectedCount > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-divider bg-surface px-4 py-2.5 shadow-xl">
          <span className="text-sm text-foreground">
            <span className="font-semibold">{selectedCount}</span> post{selectedCount > 1 ? 's' : ''} selected
          </span>
          <button
            onClick={() => setShowAddToCourse(true)}
            className="rounded-lg bg-ink px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-hover"
          >
            Add to course →
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-[13px] text-foreground-muted hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

      {showAddToCourse && (
        <AddToCourseModal
          postIds={Array.from(selectedIds)}
          onClose={() => setShowAddToCourse(false)}
          onDone={(courseId) => {
            setShowAddToCourse(false);
            setSelectedIds(new Set());
            qc.invalidateQueries({ queryKey: ['lms-items'] });
            router.push(`/admin/learning/${courseId}`);
          }}
        />
      )}

      {shareItem && (
        <ShareModal itemId={shareItem.id} itemTitle={shareItem.title} onClose={() => setShareItem(null)} />
      )}
    </div>
  );
}

// Modal: pick (or create) a course, then move the selected posts into it as
// lessons. The move re-parents each post's lesson and deletes the standalone
// post — see the server route for details.
function AddToCourseModal({
  postIds,
  onClose,
  onDone,
}: {
  postIds: string[];
  onClose: () => void;
  onDone: (courseId: string) => void;
}) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [courseId, setCourseId] = useState('');
  const [newTitle, setNewTitle] = useState('');

  const { data: coursesRes } = useQuery({
    queryKey: ['lms-items', 'course'],
    queryFn: () => api.get('/admin/lms/items?kind=course').then((r) => r.data),
  });
  const courses: LmsItem[] = coursesRes?.data || [];

  // Default to "create new" when there are no courses to pick from yet.
  const effectiveMode = courses.length === 0 ? 'new' : mode;

  const move = useMutation({
    mutationFn: async () => {
      let targetId = courseId;
      if (effectiveMode === 'new') {
        const created = await api
          .post('/admin/lms/items', { kind: 'course', title: newTitle.trim() })
          .then((r) => r.data);
        targetId = created?.data?.id;
        if (!targetId) throw new Error('Failed to create course');
      }
      await api.post(`/admin/lms/courses/${targetId}/import-posts`, { post_ids: postIds });
      return targetId;
    },
    onSuccess: (targetId) => onDone(targetId),
    onError: (e: any) => alert(e?.response?.data?.error || e?.message || 'Failed to add to course'),
  });

  const canSubmit =
    !move.isPending &&
    (effectiveMode === 'new' ? newTitle.trim().length > 0 : courseId.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !move.isPending && onClose()}>
      <div className="w-full max-w-md rounded-xl border border-divider bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-foreground">Add {postIds.length} post{postIds.length > 1 ? 's' : ''} to a course</h2>
        <p className="mt-1 text-[13px] text-foreground-muted">
          Each post becomes a lesson at the end of the course. The standalone post is removed from the library.
        </p>

        {courses.length > 0 && (
          <div className="mt-4 flex gap-2 rounded-lg bg-canvas p-1 text-[13px]">
            <button
              onClick={() => setMode('existing')}
              className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${
                effectiveMode === 'existing' ? 'bg-surface text-foreground shadow-sm' : 'text-foreground-muted'
              }`}
            >
              Existing course
            </button>
            <button
              onClick={() => setMode('new')}
              className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${
                effectiveMode === 'new' ? 'bg-surface text-foreground shadow-sm' : 'text-foreground-muted'
              }`}
            >
              New course
            </button>
          </div>
        )}

        {effectiveMode === 'existing' ? (
          <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
            {courses.map((c) => (
              <label
                key={c.id}
                className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 ${
                  courseId === c.id ? 'border-ink bg-canvas' : 'border-divider hover:bg-surface-alt'
                }`}
              >
                <input
                  type="radio"
                  name="course"
                  checked={courseId === c.id}
                  onChange={() => setCourseId(c.id)}
                  className="h-4 w-4 accent-[#0F172B]"
                />
                <span className="flex-1 truncate text-sm font-medium text-foreground">{c.title}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  c.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-canvas text-foreground-muted'
                }`}>
                  {c.status}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <div className="mt-4">
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-foreground-dim">New course title</label>
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Onboarding 101"
              className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm placeholder-foreground-dim focus:border-ink focus:outline-none"
            />
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={move.isPending}
            className="rounded-lg border border-divider bg-surface px-4 py-2 text-sm text-foreground-muted hover:bg-surface-alt disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => move.mutate()}
            disabled={!canSubmit}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-hover disabled:opacity-50"
          >
            {move.isPending ? 'Adding…' : effectiveMode === 'new' ? 'Create & add' : 'Add to course'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Create-content modal: choose a type (with side-by-side descriptions), name it,
// and go straight into the editor. Replaces the old dropdown + window.prompt.
const CONTENT_TYPES: {
  key: string;
  kind: LmsItemKind;
  track: LmsTrack;
  icon: string;
  title: string;
  desc: string;
  placeholder: string;
}[] = [
  { key: 'post', kind: 'post', track: 'learning', icon: '📄', title: 'Post', desc: 'A single self-contained update or article.', placeholder: 'e.g. Q3 product update' },
  { key: 'course', kind: 'course', track: 'learning', icon: '📚', title: 'Course', desc: 'A multi-lesson journey learners work through.', placeholder: 'e.g. Onboarding 101' },
  { key: 'sop', kind: 'post', track: 'sop', icon: '🧭', title: 'SOP / Guide', desc: 'A how-to under Systems & Procedures.', placeholder: 'e.g. How to submit an expense' },
];

function NewContentModal({
  creating,
  onCreate,
  onClose,
}: {
  creating: boolean;
  onCreate: (body: { kind: LmsItemKind; track: LmsTrack; title: string }) => void;
  onClose: () => void;
}) {
  const [typeKey, setTypeKey] = useState('post');
  const [title, setTitle] = useState('');
  const type = CONTENT_TYPES.find((t) => t.key === typeKey)!;
  const canCreate = title.trim().length > 0 && !creating;

  function submit() {
    if (!canCreate) return;
    onCreate({ kind: type.kind, track: type.track, title: title.trim() });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-divider bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-foreground">Create new content</h2>
        <p className="mt-1 text-[13px] text-foreground-muted">Pick a type to get started — you can fill in the details next.</p>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {CONTENT_TYPES.map((t) => {
            const active = t.key === typeKey;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTypeKey(t.key)}
                className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition ${
                  active ? 'border-ink bg-canvas ring-1 ring-ink' : 'border-divider bg-surface hover:bg-surface-alt'
                }`}
              >
                <span className="text-xl">{t.icon}</span>
                <span className="text-sm font-semibold text-foreground">{t.title}</span>
                <span className="text-[11px] leading-snug text-foreground-muted">{t.desc}</span>
              </button>
            );
          })}
        </div>

        <label className="mt-4 block text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Title</label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder={type.placeholder}
          className="mt-1 w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm placeholder-foreground-dim focus:border-ink focus:outline-none"
        />

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} disabled={creating} className="rounded-lg border border-divider bg-surface px-4 py-2 text-sm text-foreground-muted hover:bg-surface-alt disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submit} disabled={!canCreate} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-hover disabled:opacity-50">
            {creating ? 'Creating…' : `Create ${type.title}`}
          </button>
        </div>
      </div>
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
