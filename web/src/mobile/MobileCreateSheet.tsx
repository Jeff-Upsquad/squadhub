'use client';

/**
 * Mobile task creation — a port of the Business Android app's
 * `ui/quicktask/QuickTaskSheet.kt` rather than the desktop create panel.
 *
 * The essentials sit in view (name, description, then a horizontally scrolling
 * row of attribute chips: list, assignee, priority, due date, work date), the
 * start date hides under "More details", and each chip opens its own dialog so
 * the pickers layer predictably above the sheet instead of nesting sheets.
 *
 * It posts through the app's normal `useCreateTask`, so the created task,
 * cache invalidation and success toast are identical to the desktop path.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueries } from '@tanstack/react-query';
import type { List, TaskPriority, User } from '@squadhub/shared';
import api from '../services/api';
import { useCreateTask } from '../hooks/useTasks';
import { useAssignableUsersByList } from '../hooks/useAssignableUsers';
import { MAvatar, MIcon } from './MobileKit';
import { useMobileSpaces, type OpenTarget } from './useMobileSpaces';

const PRIORITIES: { value: TaskPriority; label: string; color: string }[] = [
  { value: 'emergency', label: 'Emergency', color: '#b91c1c' },
  { value: 'urgent', label: 'Urgent', color: '#ef4444' },
  { value: 'high', label: 'High', color: '#f97316' },
  { value: 'normal', label: 'Normal', color: '#3b82f6' },
  { value: 'low', label: 'Low', color: '#22c55e' },
  { value: 'none', label: 'No priority', color: '#9ca3af' },
];

type PickableList = { id: string; name: string; spaceId: string; group: string };

/**
 * Every list the user can file into, derived from the same spaces Home shows.
 * `GET /pm/lists?space_id=` returns every list in a space (folders included),
 * so one request per space card covers the whole tree.
 */
function usePickableLists(workspaceId: string | undefined, enabled: boolean) {
  const { groups } = useMobileSpaces(workspaceId);

  const sources = useMemo(
    () =>
      groups.flatMap((g) =>
        g.cards.map((c) => ({ target: c.target, group: g.heading, title: c.title })),
      ),
    [groups],
  );

  const results = useQueries({
    queries: sources.map(({ target, group, title }) => {
      const query =
        target.kind === 'space' ? `space_id=${target.id}` : `folder_id=${target.id}`;
      return {
        queryKey: ['mobile-pickable-lists', target.kind, target.id],
        // A list card is already a leaf — no fetch needed for it.
        enabled: enabled && target.kind !== 'list',
        staleTime: 60_000,
        queryFn: async (): Promise<PickableList[]> => {
          const res = await api.get(`/pm/lists?${query}`);
          const lists: List[] = res.data.data ?? [];
          return lists
            .filter((l) => !l.is_locked)
            .map((l) => ({
              id: l.id,
              name: l.name,
              spaceId: l.space_id,
              group: target.kind === 'space' ? title : `${group} · ${title}`,
            }));
        },
      };
    }),
  });

  const lists = useMemo(() => {
    const out: PickableList[] = [];
    sources.forEach((s, i) => {
      if (s.target.kind === 'list') {
        out.push({
          id: s.target.id,
          name: s.target.title,
          spaceId: s.target.spaceId,
          group: s.group,
        });
        return;
      }
      out.push(...(results[i]?.data ?? []));
    });
    // One space can surface twice (an area and a shared root), so de-dupe.
    return out.filter((l, i, all) => all.findIndex((x) => x.id === l.id) === i);
  }, [sources, results]);

  return { lists, loading: results.some((r) => r.isLoading) };
}

export default function MobileCreateSheet({
  workspaceId,
  /** Space the sheet was opened from (a Home card's "+"), pre-selected if possible. */
  preset,
  onClose,
  onCreated,
}: {
  workspaceId: string | undefined;
  preset?: OpenTarget | null;
  onClose: () => void;
  onCreated?: (taskId: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [listId, setListId] = useState<string | null>(
    preset?.kind === 'list' ? preset.id : null,
  );
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [priority, setPriority] = useState<TaskPriority>('none');
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [workDate, setWorkDate] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [picker, setPicker] = useState<'list' | 'assignee' | 'priority' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const { lists, loading: listsLoading } = usePickableLists(workspaceId, true);
  const create = useCreateTask(null);

  const selected = lists.find((l) => l.id === listId) ?? null;

  // Pre-target the space the "+" came from: its first list, once they load.
  useEffect(() => {
    if (listId || !preset || preset.kind === 'list' || !lists.length) return;
    const scope = preset.kind === 'space' ? preset.id : preset.spaceId;
    const first = lists.find((l) => l.spaceId === scope);
    if (first) setListId(first.id);
  }, [preset, lists, listId]);

  // The sheet animates in, so focus on the next frame rather than on mount.
  useEffect(() => {
    const id = requestAnimationFrame(() => titleRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Assignees belong to the chosen list — clear them when the list changes.
  const assignable = useAssignableUsersByList(picker === 'assignee' ? listId : null);

  const canSubmit = title.trim().length > 0 && !!listId && !create.isPending;

  const submit = async () => {
    if (!canSubmit || !listId) return;
    setError(null);
    try {
      const task = await create.mutateAsync({
        title: title.trim(),
        list_id: listId,
        description: description.trim() || undefined,
        priority: priority === 'none' ? undefined : priority,
        due_date: dueDate || undefined,
        work_date: workDate || undefined,
        start_date: startDate || undefined,
        assignee_ids: assigneeIds.length ? assigneeIds : undefined,
      });
      onCreated?.(task?.id);
      onClose();
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? `Couldn't create the task — ${e.message}`
          : "Couldn't create the task. Try again.",
      );
    }
  };

  const priorityMeta = PRIORITIES.find((p) => p.value === priority)!;

  const sheet = (
    <>
      <div className="mcs-scrim" onClick={onClose} aria-hidden />
      <div className="mcs" role="dialog" aria-modal="true" aria-label="New task">
        <div className="mcs-grip" aria-hidden />

        <div className="mcs-head">
          <h2>New task</h2>
          <button
            type="button"
            className="mcs-create"
            disabled={!canSubmit}
            onClick={submit}
          >
            {create.isPending ? <span className="mcs-spin" aria-label="Creating" /> : 'Create'}
          </button>
        </div>

        <div className="mcs-body">
          <textarea
            ref={titleRef}
            className="mcs-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task name"
            rows={1}
            onInput={(e) => {
              // Grow with the text, up to the 3 lines the native sheet allows.
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
            }}
          />
          <textarea
            className="mcs-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add description…"
            rows={2}
          />

          <div className="mcs-chips">
            <Chip
              icon={MIcon.list}
              label={
                selected ? selected.name : listsLoading ? 'Loading lists…' : 'Select list'
              }
              on={!!selected}
              onClick={() => setPicker('list')}
            />
            <Chip
              icon={MIcon.people}
              label={
                assigneeIds.length === 0
                  ? 'Assignee'
                  : assigneeIds.length === 1
                    ? '1 assignee'
                    : `${assigneeIds.length} assignees`
              }
              on={assigneeIds.length > 0}
              disabled={!listId}
              onClick={() => setPicker('assignee')}
            />
            <Chip
              icon={MIcon.flag}
              label={priority === 'none' ? 'Priority' : priorityMeta.label}
              on={priority !== 'none'}
              dot={priority === 'none' ? undefined : priorityMeta.color}
              onClick={() => setPicker('priority')}
            />
            <DateChip
              icon={MIcon.calendar}
              label="Due date"
              value={dueDate}
              onChange={setDueDate}
            />
            <DateChip
              icon={MIcon.checkin}
              label="Work date"
              value={workDate}
              onChange={setWorkDate}
            />
          </div>

          <button
            type="button"
            className="mcs-more"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
          >
            <span>More details</span>
            <span className={`mcs-more-chev${moreOpen ? ' is-open' : ''}`}>{MIcon.chevron}</span>
          </button>
          {moreOpen && (
            <div className="mcs-more-body">
              <DateChip
                icon={MIcon.calendar}
                label="Start date"
                value={startDate}
                onChange={setStartDate}
              />
            </div>
          )}

          {error && <p className="mcs-error">{error}</p>}
        </div>
      </div>

      {picker === 'list' && (
        <PickerDialog title="Create in…" onClose={() => setPicker(null)}>
          {listsLoading && lists.length === 0 && <p className="mcs-dlg-hint">Loading lists…</p>}
          {!listsLoading && lists.length === 0 && (
            <p className="mcs-dlg-hint">No lists you can add tasks to.</p>
          )}
          {lists.map((l) => (
            <button
              key={l.id}
              type="button"
              className="mcs-opt"
              data-on={l.id === listId ? 'true' : undefined}
              onClick={() => {
                if (l.id !== listId) setAssigneeIds([]);
                setListId(l.id);
                setPicker(null);
              }}
            >
              <span className="mcs-opt-ic">{MIcon.list}</span>
              <span className="mcs-opt-body">
                <b>{l.name}</b>
                <span>{l.group}</span>
              </span>
            </button>
          ))}
        </PickerDialog>
      )}

      {picker === 'assignee' && (
        <PickerDialog title="Assign to" onClose={() => setPicker(null)}>
          {assignable.isLoading && <p className="mcs-dlg-hint">Loading people…</p>}
          {!assignable.isLoading && !assignable.data?.length && (
            <p className="mcs-dlg-hint">No one to assign in this list.</p>
          )}
          {(assignable.data ?? []).map((u: User) => {
            const on = assigneeIds.includes(u.id);
            return (
              <button
                key={u.id}
                type="button"
                className="mcs-opt"
                data-on={on ? 'true' : undefined}
                onClick={() =>
                  setAssigneeIds((prev) =>
                    prev.includes(u.id) ? prev.filter((x) => x !== u.id) : [...prev, u.id],
                  )
                }
              >
                <MAvatar name={u.display_name} url={u.avatar_url} size={32} />
                <span className="mcs-opt-body">
                  <b>{u.display_name || u.email}</b>
                </span>
                {on && <span className="mcs-opt-tick">{MIcon.tick}</span>}
              </button>
            );
          })}
        </PickerDialog>
      )}

      {picker === 'priority' && (
        <PickerDialog title="Priority" onClose={() => setPicker(null)}>
          {PRIORITIES.map((p) => (
            <button
              key={p.value}
              type="button"
              className="mcs-opt"
              data-on={p.value === priority ? 'true' : undefined}
              onClick={() => { setPriority(p.value); setPicker(null); }}
            >
              <span className="mcs-opt-dot" style={{ background: p.color }} />
              <span className="mcs-opt-body">
                <b>{p.label}</b>
              </span>
            </button>
          ))}
        </PickerDialog>
      )}
    </>
  );

  // Portalled to the body so the sheet clears the shell's stacking context and
  // the on-screen keyboard doesn't shove the whole shell up with it.
  return typeof document === 'undefined' ? null : createPortal(sheet, document.body);
}

function Chip({
  icon,
  label,
  on,
  dot,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  on?: boolean;
  dot?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="mcs-chip"
      data-on={on ? 'true' : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {dot ? <span className="mcs-chip-dot" style={{ background: dot }} /> : <span className="mcs-chip-ic">{icon}</span>}
      <span>{label}</span>
    </button>
  );
}

/** A chip whose value comes from a native date input — the OS picker is the
 *  best date UI on a phone, so it's used instead of a custom calendar. */
function DateChip({
  icon,
  label,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const shown = value
    ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : label;
  return (
    <span className="mcs-chip" data-on={value ? 'true' : undefined}>
      <span className="mcs-chip-ic">{icon}</span>
      <span
        onClick={() => {
          // showPicker() is the only way to open the OS picker from the chip
          // body; Safari doesn't implement it, so fall back to focusing.
          const el = ref.current;
          if (!el) return;
          const withPicker = el as HTMLInputElement & { showPicker?: () => void };
          if (typeof withPicker.showPicker === 'function') withPicker.showPicker();
          else el.focus();
        }}
      >
        {shown}
      </span>
      {value && (
        <button type="button" className="mcs-chip-x" aria-label={`Clear ${label}`} onClick={() => onChange(null)}>
          {MIcon.close}
        </button>
      )}
      <input
        ref={ref}
        type="date"
        className="mcs-chip-date"
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      />
    </span>
  );
}

function PickerDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="mcs-dlg-scrim" onClick={onClose} aria-hidden />
      <div className="mcs-dlg" role="dialog" aria-modal="true" aria-label={title}>
        <div className="mcs-dlg-head">
          <b>{title}</b>
          <button type="button" className="mcs-dlg-x" aria-label="Close" onClick={onClose}>
            {MIcon.close}
          </button>
        </div>
        <div className="mcs-dlg-body">{children}</div>
      </div>
    </>
  );
}
