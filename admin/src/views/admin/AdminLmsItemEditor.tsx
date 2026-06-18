'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { LmsItem, LmsLesson, LmsCategory, UserType } from '@squadhub/shared';
import BlockList from '../../components/lms/BlockList';
import AudiencePicker from '../../components/lms/AudiencePicker';
import MediaUploader from '../../components/lms/MediaUploader';

interface Props {
  itemId: string;
}

type ItemDetail = LmsItem & {
  lessons: LmsLesson[];
  audience_types: UserType[];
  audience_user_ids: string[];
};

// All audience user types — used by the SOP "Everyone" quick-set, since
// guides are normally shared with the whole org (no audience = nobody sees it).
const ALL_USER_TYPES: UserType[] = ['internal', 'client', 'client_staff', 'partner', 'partner_employee'];

export default function AdminLmsItemEditor({ itemId }: Props) {
  const qc = useQueryClient();
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [showLessonAudience, setShowLessonAudience] = useState(false);

  const { data: itemRes, isLoading } = useQuery({
    queryKey: ['lms-item', itemId],
    queryFn: () => api.get(`/admin/lms/items/${itemId}`).then((r) => r.data),
  });
  const item: ItemDetail | undefined = itemRes?.data;

  const { data: catRes } = useQuery({
    queryKey: ['lms-categories'],
    queryFn: () => api.get('/admin/lms/categories').then((r) => r.data),
  });
  const categories: LmsCategory[] = catRes?.data || [];

  useEffect(() => {
    if (!activeLessonId && item?.lessons?.length) {
      setActiveLessonId(item.lessons[0].id);
    }
  }, [item, activeLessonId]);

  const patchItem = useMutation({
    mutationFn: (body: any) => api.patch(`/admin/lms/items/${itemId}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms-item', itemId] }),
  });

  const setAudience = useMutation({
    mutationFn: (body: any) => api.put(`/admin/lms/items/${itemId}/audience`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms-item', itemId] }),
  });

  const publish = useMutation({
    mutationFn: () => api.post(`/admin/lms/items/${itemId}/publish`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lms-item', itemId] });
      qc.invalidateQueries({ queryKey: ['lms-items'] });
    },
    onError: (e: any) => alert(e?.response?.data?.error || 'Publish failed'),
  });

  const unpublish = useMutation({
    mutationFn: () => api.post(`/admin/lms/items/${itemId}/unpublish`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lms-item', itemId] });
      qc.invalidateQueries({ queryKey: ['lms-items'] });
    },
  });

  const resync = useMutation({
    mutationFn: () => api.post(`/admin/lms/items/${itemId}/resync-audience`),
    onSuccess: (res: any) => alert(`Synced ${res?.data?.data?.synced_user_count ?? 0} users`),
  });

  const addLesson = useMutation({
    mutationFn: () => api.post(`/admin/lms/items/${itemId}/lessons`, {}).then((r) => r.data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['lms-item', itemId] });
      if (res?.data?.id) setActiveLessonId(res.data.id);
    },
  });

  const patchLesson = useMutation({
    mutationFn: ({ id, ...body }: any) => api.patch(`/admin/lms/lessons/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms-item', itemId] }),
  });

  const deleteLesson = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/lms/lessons/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lms-item', itemId] });
      setActiveLessonId(null);
    },
  });

  const setLessonAudience = useMutation({
    mutationFn: ({ id, ...body }: any) => api.put(`/admin/lms/lessons/${id}/audience`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms-item', itemId] }),
  });

  if (isLoading || !item) {
    return <div className="p-8 text-sm text-foreground-dim">Loading…</div>;
  }

  const activeLesson = item.lessons.find((l) => l.id === activeLessonId) || item.lessons[0];
  const isCourse = item.kind === 'course';
  const lessonAudTypes: UserType[] = (activeLesson?.audience_types as UserType[]) || [];
  const lessonAudUsers: string[] = activeLesson?.audience_user_ids || [];
  const lessonRestricted = lessonAudTypes.length > 0 || lessonAudUsers.length > 0;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/admin/learning" className="mb-2 inline-flex items-center gap-1 text-[12px] text-foreground-muted hover:text-foreground">
            ← Learning Library
          </Link>
          <div className="flex items-center gap-2">
            <input
              defaultValue={item.title}
              onBlur={(e) => { if (e.target.value !== item.title) patchItem.mutate({ title: e.target.value }); }}
              className="min-w-0 flex-1 border-none bg-transparent font-[family-name:var(--font-display)] text-xl font-bold text-foreground outline-none"
            />
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              item.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-canvas text-foreground-muted'
            }`}>
              {item.status}
            </span>
            {item.track === 'sop' ? (
              <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                SOP / Guide
              </span>
            ) : (
              <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                {item.kind}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/learning/${itemId}/assignments`}
            className="rounded-lg border border-divider bg-surface px-3 py-2 text-sm text-foreground-muted hover:bg-surface-alt"
          >
            View roster ({item.assignment_count ?? 0})
          </Link>
          {item.status === 'published' && (
            <button
              onClick={() => resync.mutate()}
              className="rounded-lg border border-divider bg-surface px-3 py-2 text-sm text-foreground-muted hover:bg-surface-alt"
              title="Assign to any new users who joined the audience after publish"
            >
              Resync audience
            </button>
          )}
          {item.status === 'published' ? (
            <button
              onClick={() => { if (confirm('Unpublish this content? Users will keep their assignments.')) unpublish.mutate(); }}
              className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
            >
              Unpublish
            </button>
          ) : (
            <button
              onClick={() => { setPublishBusy(true); publish.mutate(undefined, { onSettled: () => setPublishBusy(false) }); }}
              disabled={publishBusy || publish.isPending}
              className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-hover disabled:opacity-50"
            >
              {publishBusy || publish.isPending ? 'Publishing…' : 'Publish'}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        {/* Left: metadata + audience */}
        <aside className="space-y-6">
          <Section title="Overview">
            <Field label="Summary">
              <textarea
                defaultValue={item.summary || ''}
                onBlur={(e) => { if (e.target.value !== (item.summary || '')) patchItem.mutate({ summary: e.target.value || null }); }}
                rows={3}
                placeholder="One-line description (shown on cards)"
                className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm placeholder-foreground-dim focus:border-ink focus:outline-none"
              />
            </Field>
            <Field label="Category">
              <select
                value={item.category_id || ''}
                onChange={(e) => patchItem.mutate({ category_id: e.target.value || null })}
                className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm focus:border-ink focus:outline-none"
              >
                <option value="">— None —</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Cover image">
              {item.lessons[0] ? (
                <>
                  <MediaUploader
                    itemId={item.id}
                    lessonId={item.lessons[0].id}
                    fileCategory="image"
                    accept="image/*"
                    current={{ url: item.cover_image_url || null, name: null }}
                    onUploaded={(f) => patchItem.mutate({ cover_image_url: f.url })}
                  />
                  {item.cover_image_url && (
                    <img src={item.cover_image_url} alt="" className="mt-2 h-32 w-full rounded-md object-cover" />
                  )}
                </>
              ) : <p className="text-[12px] text-foreground-dim">Add a lesson first</p>}
            </Field>
          </Section>

          <Section title="Audience">
            {item.track === 'sop' && (
              <div className="mb-2.5 flex items-center justify-between gap-2 rounded-md bg-indigo-50 px-2.5 py-2 text-[11.5px] leading-snug text-indigo-800">
                <span>Guides are usually shared with everyone. No audience = nobody sees it.</span>
                <button
                  onClick={() => setAudience.mutate({ user_types: ALL_USER_TYPES, user_ids: item.audience_user_ids || [] })}
                  className="shrink-0 rounded border border-indigo-300 bg-white px-2 py-0.5 font-medium text-indigo-700 hover:bg-indigo-100"
                >
                  Everyone
                </button>
              </div>
            )}
            <AudiencePicker
              userTypes={item.audience_types || []}
              userIds={item.audience_user_ids || []}
              onChange={(next) => setAudience.mutate(next)}
            />
          </Section>
        </aside>

        {/* Right: lessons + blocks */}
        <main className="min-w-0 space-y-4">
          {isCourse && (
            <div className="rounded-xl border border-divider bg-surface">
              <div className="flex items-center justify-between border-b border-divider px-4 py-2.5">
                <h3 className="text-[13px] font-semibold text-foreground">Lessons</h3>
                <button
                  onClick={() => addLesson.mutate()}
                  className="rounded-md border border-divider bg-surface px-2.5 py-1 text-[12px] text-foreground-muted hover:bg-surface-alt"
                >
                  + Add lesson
                </button>
              </div>
              <ul className="p-2">
                {item.lessons.map((lesson, i) => {
                  const inactive = lesson.is_active === false;
                  return (
                    <li key={lesson.id}>
                      <button
                        onClick={() => setActiveLessonId(lesson.id)}
                        className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition ${
                          activeLessonId === lesson.id ? 'bg-canvas text-foreground' : 'text-foreground-muted hover:bg-surface-alt'
                        }`}
                      >
                        <span className="w-5 text-right font-mono text-[11px] text-foreground-dim">{i + 1}.</span>
                        <span className={`flex-1 truncate font-medium ${inactive ? 'text-foreground-dim line-through decoration-[#CAD5E2]' : ''}`}>{lesson.title}</span>
                        {inactive && (
                          <span className="shrink-0 rounded-full bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted">Inactive</span>
                        )}
                      </button>
                    </li>
                  );
                })}
                {item.lessons.length === 0 && (
                  <li className="px-3 py-4 text-center text-[12px] text-foreground-dim">No lessons yet</li>
                )}
              </ul>
            </div>
          )}

          {activeLesson && (
            <div className="rounded-xl border border-divider bg-surface p-4">
              {isCourse && (
                <div className="mb-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Lesson name</label>
                      <input
                        key={activeLesson.id}
                        defaultValue={activeLesson.title}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== activeLesson.title) patchLesson.mutate({ id: activeLesson.id, title: v });
                        }}
                        placeholder="Lesson name"
                        className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-base font-semibold text-foreground focus:border-ink focus:outline-none"
                      />
                    </div>
                    {item.lessons.length > 1 && (
                      <button
                        onClick={() => { if (confirm(`Delete lesson "${activeLesson.title}"?`)) deleteLesson.mutate(activeLesson.id); }}
                        className="mt-6 shrink-0 text-[12px] text-red-600 hover:underline"
                      >
                        Delete lesson
                      </button>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Description</label>
                    <textarea
                      key={`desc-${activeLesson.id}`}
                      defaultValue={activeLesson.summary || ''}
                      onBlur={(e) => {
                        if (e.target.value !== (activeLesson.summary || '')) {
                          patchLesson.mutate({ id: activeLesson.id, summary: e.target.value || null });
                        }
                      }}
                      rows={2}
                      placeholder="Optional — shown to learners under the lesson title"
                      className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm placeholder-foreground-dim focus:border-ink focus:outline-none"
                    />
                  </div>

                  <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-divider bg-surface-alt px-3 py-2">
                    <input
                      type="checkbox"
                      checked={activeLesson.is_active ?? true}
                      onChange={(e) => patchLesson.mutate({ id: activeLesson.id, is_active: e.target.checked })}
                      className="h-4 w-4 rounded border-divider-strong accent-[#0F172B]"
                    />
                    <span className="text-[13px] font-medium text-foreground">Active</span>
                    <span className="text-[12px] text-foreground-dim">
                      {(activeLesson.is_active ?? true) ? 'Visible to learners' : 'Hidden from learners — only visible here'}
                    </span>
                  </label>
                </div>
              )}
              {isCourse && (
                <div className="mb-4 rounded-lg border border-divider bg-surface-alt">
                  <button
                    type="button"
                    onClick={() => setShowLessonAudience((v) => !v)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left"
                  >
                    <span className="text-foreground-dim">{showLessonAudience ? '▾' : '▸'}</span>
                    <span className="text-[12px] font-medium text-foreground">Who can see this lesson</span>
                    <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      lessonRestricted ? 'bg-amber-50 text-amber-700' : 'bg-canvas text-foreground-muted'
                    }`}>
                      {lessonRestricted
                        ? `Restricted${lessonAudTypes.length ? ` · ${lessonAudTypes.length} type${lessonAudTypes.length > 1 ? 's' : ''}` : ''}${lessonAudUsers.length ? ` · ${lessonAudUsers.length} ${lessonAudUsers.length > 1 ? 'people' : 'person'}` : ''}`
                        : 'Everyone in this course'}
                    </span>
                  </button>
                  {showLessonAudience && (
                    <div className="border-t border-divider p-3">
                      <p className="mb-3 text-[11px] leading-snug text-foreground-dim">
                        Leave everything empty to show this lesson to everyone enrolled in the course.
                        Pick user types or specific people to restrict it — everyone else won&apos;t see the lesson at all.
                      </p>
                      <AudiencePicker
                        userTypes={lessonAudTypes}
                        userIds={lessonAudUsers}
                        onChange={(next) => setLessonAudience.mutate({ id: activeLesson.id, ...next })}
                      />
                    </div>
                  )}
                </div>
              )}
              <BlockList
                itemId={item.id}
                lessonId={activeLesson.id}
                blocks={activeLesson.blocks || []}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-divider bg-surface p-4">
      <h3 className="mb-3 text-[13px] font-semibold text-foreground">{title}</h3>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-foreground-dim">{label}</label>
      {children}
    </div>
  );
}
