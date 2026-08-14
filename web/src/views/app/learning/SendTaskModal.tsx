'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';

type Lesson = { id: string; title: string; blocks?: any[] };
interface Props {
  itemId: string;
  itemTitle: string;
  itemKind: string;
  itemTrack: string;
  lessons: Lesson[];
  onClose: () => void;
}

type Scope = 'item' | 'lesson' | 'section';
type Principal = { type: 'user' | 'role'; id: string; label: string; sub?: string; color?: string };
type Heading = { anchor: string; label: string; level: number; index: number };

function slugifyHeading(text: string, i: number) {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48);
  return `sec-${i}-${base || 'section'}`;
}
function textOf(node: any): string {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (Array.isArray(node.content)) return node.content.map(textOf).join('');
  return '';
}
function extractHeadings(blocks: any[] | undefined): Heading[] {
  const out: Heading[] = [];
  let i = 0;
  const ordered = (blocks || []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const walk = (nodes: any[]) => {
    for (const n of nodes || []) {
      if (n?.type === 'heading') {
        const text = textOf(n).trim();
        if (text) {
          out.push({ anchor: slugifyHeading(text, i), label: text, level: n.attrs?.level || 1, index: i });
          i += 1;
        }
      } else if (Array.isArray(n?.content)) {
        walk(n.content);
      }
    }
  };
  for (const b of ordered) {
    if (b.type !== 'text' || !b.text_content) continue;
    walk(b.text_content.content || []);
  }
  return out;
}

export default function SendTaskModal({ itemId, itemTitle, itemKind, itemTrack, lessons, onClose }: Props) {
  const qc = useQueryClient();
  const isCourse = itemKind === 'course';

  const [scope, setScope] = useState<Scope>(isCourse ? 'lesson' : 'item');
  const [lessonId, setLessonId] = useState<string>(lessons[0]?.id || '');
  const [sectionAnchor, setSectionAnchor] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [autoResend, setAutoResend] = useState(false);
  const [principals, setPrincipals] = useState<Principal[]>([]);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'people' | 'roles'>('people');
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);

  const activeLesson = lessons.find((l) => l.id === lessonId) || lessons[0];
  const headings = useMemo(() => extractHeadings(activeLesson?.blocks), [activeLesson]);
  const activeHeading = headings.find((h) => h.anchor === sectionAnchor) || null;

  const kindWord = itemTrack === 'sop' ? 'SOP' : isCourse ? 'Course' : 'Post';

  const derivedTitle = useMemo(() => {
    if (scope === 'item') return `${kindWord}: ${itemTitle}`;
    if (scope === 'lesson') return `${kindWord}: ${itemTitle} — ${activeLesson?.title || 'Lesson'}`;
    return `${kindWord}: ${itemTitle} › ${activeHeading?.label || 'Section'}`;
  }, [scope, kindWord, itemTitle, activeLesson, activeHeading]);
  const effectiveTitle = titleTouched ? title : derivedTitle;

  // Prefill recipients from the item's current shares.
  const { data: shares } = useQuery({
    queryKey: ['lms-collab-send-shares', itemId],
    queryFn: async () => (await api.get(`/lms/collab/items/${itemId}/shares`)).data.data as any[],
  });
  useEffect(() => {
    if (!shares || principals.length) return;
    const mapped = shares
      .filter((s) => s.principal_type !== 'user_type')
      .map((s) => ({
        type: s.principal_type as 'user' | 'role',
        id: s.principal_id,
        label: s.principal_type === 'user' ? (s.user?.display_name || s.user?.email || 'Unknown') : (s.role?.name || 'Role'),
        sub: s.principal_type === 'user' ? s.user?.email ?? undefined : 'Role',
        color: s.principal_type === 'role' ? s.role?.color ?? undefined : undefined,
      }));
    if (mapped.length) setPrincipals(mapped);
  }, [shares, principals.length]);

  const { data: usersRes } = useQuery({
    queryKey: ['lms-collab-send-users', q],
    queryFn: () => api.get(`/lms/collab/principals/users?q=${encodeURIComponent(q)}`).then((r) => r.data),
    enabled: tab === 'people',
  });
  const users: { id: string; display_name: string | null; email: string | null }[] = usersRes?.data || [];

  const { data: rolesRes } = useQuery({
    queryKey: ['lms-collab-send-roles'],
    queryFn: () => api.get('/lms/collab/principals/roles').then((r) => r.data),
    enabled: tab === 'roles',
  });
  const roles: { id: string; name: string; color: string | null }[] = rolesRes?.data || [];

  const takenIds = useMemo(() => new Set(principals.map((p) => `${p.type}:${p.id}`)), [principals]);
  function add(p: Principal) {
    setPrincipals((prev) => (prev.some((x) => x.type === p.type && x.id === p.id) ? prev : [...prev, p]));
  }
  function remove(i: number) {
    setPrincipals((prev) => prev.filter((_, idx) => idx !== i));
  }

  const send = useMutation({
    mutationFn: () =>
      api.post(`/lms/collab/items/${itemId}/task-sends`, {
        scope,
        lesson_id: scope === 'item' ? null : lessonId,
        section: scope === 'section' && activeHeading
          ? { anchor: activeHeading.anchor, label: activeHeading.label, index: activeHeading.index }
          : null,
        title: effectiveTitle.trim(),
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        auto_resend: autoResend,
        principals: principals.map((p) => ({ type: p.type, id: p.id })),
      }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['lms-collab-send-shares', itemId] });
      alert(`Sent as a task to ${res?.data?.data?.recipientCount ?? 0} ${res?.data?.data?.recipientCount === 1 ? 'person' : 'people'}.`);
      onClose();
    },
    onError: (e: any) => alert(e?.response?.data?.error || 'Failed to send'),
  });

  const canSend =
    principals.length > 0 &&
    effectiveTitle.trim().length > 0 &&
    (scope === 'item' || !!lessonId) &&
    (scope !== 'section' || !!activeHeading);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !send.isPending && onClose()}>
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-xl border border-[var(--sh-hair)] bg-[var(--surface)] shadow-[0_12px_32px_rgba(16,24,40,.14)]" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-[var(--sh-hair)] px-5 py-4">
          <h2 className="text-lg font-bold text-[var(--sh-ink)]">Send as task</h2>
          <p className="mt-0.5 text-[12.5px] text-[var(--sh-ink-3)]">
            Assign this {kindWord.toLowerCase()} — or part of it — as a trackable task. Recipients get access and a task to complete.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Scope */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-[var(--sh-ink-3)]">What to send</label>
            <div className="flex flex-wrap gap-1.5">
              {(['item', 'lesson', 'section'] as Scope[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={`rounded-md border px-3 py-1.5 text-[12.5px] font-medium capitalize transition ${
                    scope === s ? 'border-[var(--sh-ink)] bg-[var(--sh-ink)] text-[var(--sidebar)]' : 'border-[var(--sh-hair)] bg-[var(--surface)] text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)]'
                  }`}
                >
                  {s === 'item' ? `Whole ${kindWord.toLowerCase()}` : s}
                </button>
              ))}
            </div>
          </div>

          {(scope === 'lesson' || scope === 'section') && (
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-[var(--sh-ink-3)]">
                {isCourse ? 'Lesson' : 'Page'}
              </label>
              <select
                value={lessonId}
                onChange={(e) => { setLessonId(e.target.value); setSectionAnchor(''); }}
                className="w-full rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-sm focus:border-[var(--sh-ink)] focus:outline-none"
              >
                {lessons.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
              </select>
            </div>
          )}

          {scope === 'section' && (
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-[var(--sh-ink-3)]">Section (heading)</label>
              {headings.length === 0 ? (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                  No headings found on this {isCourse ? 'lesson' : 'page'}. Add a heading to send a section, or send the whole {isCourse ? 'lesson' : 'page'}.
                </p>
              ) : (
                <select
                  value={sectionAnchor}
                  onChange={(e) => setSectionAnchor(e.target.value)}
                  className="w-full rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-sm focus:border-[var(--sh-ink)] focus:outline-none"
                >
                  <option value="">— Choose a section —</option>
                  {headings.map((h) => (
                    <option key={h.anchor} value={h.anchor}>{'  '.repeat(Math.max(0, h.level - 1))}{h.label}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-[var(--sh-ink-3)]">Task title</label>
            <input
              value={effectiveTitle}
              onChange={(e) => { setTitle(e.target.value); setTitleTouched(true); }}
              className="w-full rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-sm focus:border-[var(--sh-ink)] focus:outline-none"
            />
          </div>

          {/* Due + auto-resend */}
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-[var(--sh-ink-3)]">Due date (optional)</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-sm focus:border-[var(--sh-ink)] focus:outline-none"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 pb-2 text-[12.5px] text-[var(--sh-ink)]">
              <input type="checkbox" checked={autoResend} onChange={(e) => setAutoResend(e.target.checked)} className="h-4 w-4 accent-[var(--sh-ink)]" />
              Auto-resend when this content is updated
            </label>
          </div>

          {/* Recipients */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-[var(--sh-ink-3)]">Send to</label>
            <div className="mb-2 flex gap-1 rounded-lg bg-[var(--sidebar)] p-1 text-[13px]">
              <button onClick={() => setTab('people')} className={`flex-1 rounded-md px-3 py-1 font-medium transition ${tab === 'people' ? 'bg-[var(--surface)] text-[var(--sh-ink)] shadow-sm' : 'text-[var(--sh-ink-3)]'}`}>People</button>
              <button onClick={() => setTab('roles')} className={`flex-1 rounded-md px-3 py-1 font-medium transition ${tab === 'roles' ? 'bg-[var(--surface)] text-[var(--sh-ink)] shadow-sm' : 'text-[var(--sh-ink-3)]'}`}>Roles</button>
            </div>
            {tab === 'people' ? (
              <>
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search people by name or email"
                  className="w-full rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-sm placeholder-[var(--sh-ink-3)] focus:border-[var(--sh-ink)] focus:outline-none"
                />
                {q && (
                  <ul className="mt-2 max-h-36 overflow-y-auto rounded-md border border-[var(--sh-hair)]">
                    {users.filter((u) => !takenIds.has(`user:${u.id}`)).slice(0, 20).map((u) => (
                      <li key={u.id}>
                        <button type="button" onClick={() => add({ type: 'user', id: u.id, label: u.display_name || u.email || 'Unknown', sub: u.email || undefined })} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--sh-hair-3)]">
                          <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--sidebar)] text-[10px] font-semibold text-[var(--sh-ink-2)]">{(u.display_name || u.email || '?').slice(0, 2).toUpperCase()}</span>
                          <span className="flex-1 truncate text-[var(--sh-ink)]">{u.display_name || u.email}</span>
                          <span className="text-[11px] text-[var(--sh-ink)]">+ Add</span>
                        </button>
                      </li>
                    ))}
                    {users.length === 0 && <li className="px-3 py-2 text-[12px] text-[var(--sh-ink-3)]">No people found</li>}
                  </ul>
                )}
              </>
            ) : (
              <ul className="max-h-36 overflow-y-auto rounded-md border border-[var(--sh-hair)]">
                {roles.filter((r) => !takenIds.has(`role:${r.id}`)).map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => add({ type: 'role', id: r.id, label: r.name, sub: 'Role', color: r.color || undefined })} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--sh-hair-3)]">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.color || '#9ca3af' }} />
                      <span className="flex-1 truncate text-[var(--sh-ink)]">{r.name}</span>
                      <span className="text-[11px] text-[var(--sh-ink)]">+ Add</span>
                    </button>
                  </li>
                ))}
                {roles.length === 0 && <li className="px-3 py-2 text-[12px] text-[var(--sh-ink-3)]">No roles</li>}
              </ul>
            )}

            {principals.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {principals.map((p, i) => (
                  <li key={`${p.type}:${p.id}`} className="flex items-center gap-2 rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-2.5 py-1.5">
                    {p.type === 'role' ? (
                      <span className="grid h-7 w-7 place-items-center rounded-full" style={{ backgroundColor: (p.color || '#6b7280') + '22' }}>
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color || '#6b7280' }} />
                      </span>
                    ) : (
                      <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--sidebar)] text-[10px] font-semibold text-[var(--sh-ink-2)]">{p.label.slice(0, 2).toUpperCase()}</span>
                    )}
                    <span className="flex-1 truncate">
                      <span className="block truncate text-sm text-[var(--sh-ink)]">{p.label}</span>
                      {p.sub && <span className="block truncate text-[11px] text-[var(--sh-ink-3)]">{p.sub}</span>}
                    </span>
                    <button onClick={() => remove(i)} className="rounded p-1 text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-red-600" title="Remove">×</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--sh-hair)] px-5 py-3">
          <span className="text-[11px] text-[var(--sh-ink-3)]">Roles cover their current & future members.</span>
          <div className="flex gap-2">
            <button onClick={onClose} disabled={send.isPending} className="rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)] px-4 py-2 text-sm text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] disabled:opacity-50">Cancel</button>
            <button onClick={() => send.mutate()} disabled={!canSend || send.isPending} className="rounded-lg bg-[var(--sh-ink)] px-4 py-2 text-sm font-medium text-[var(--sidebar)] hover:opacity-90 disabled:opacity-50">
              {send.isPending ? 'Sending…' : 'Send task'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
