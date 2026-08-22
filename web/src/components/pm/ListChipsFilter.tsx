import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AccessLevel, List } from '@squadhub/shared';
import { canAtLeast } from '../../lib/access';
import SettingsSlider from '../SettingsSlider';

interface ListChipsFilterProps {
  /** Row eyebrow, e.g. "List" or "Lists". */
  label: string;
  lists: List[];
  /**
   * Live task count per list id. A missing entry means "not loaded yet" — the
   * chip stays in the main row without a badge until its count arrives.
   */
  counts: Record<string, number>;
  /** Currently filtered list id, or 'all'. */
  value: string;
  onChange: (next: string) => void;
  /** Access level of the viewer on the parent space/folder — gates settings. */
  myAccess?: AccessLevel | null;
  /**
   * Fired after a drag-drop reorder with the full sibling order (every list id,
   * empty ones last). When omitted, chips are not draggable.
   */
  onReorder?: (orderedIds: string[]) => void;
  /** Fired after the settings slider closes (rename/move/delete may have happened). */
  onSettingsClosed?: () => void;
}

export default function ListChipsFilter({
  label,
  lists,
  counts,
  value,
  onChange,
  myAccess,
  onReorder,
  onSettingsClosed,
}: ListChipsFilterProps) {
  const [emptyOpen, setEmptyOpen] = useState(false);
  const [settingsList, setSettingsList] = useState<List | null>(null);
  const emptyRef = useRef<HTMLDivElement | null>(null);
  // Drag-to-reorder state (HTML5 DnD): which chip is being dragged and where
  // the insertion line currently sits.
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);

  const canManageList = (l: List) => canAtLeast(myAccess ?? undefined, 'manager') && !l.is_locked;
  const canDragChips = !!onReorder && canAtLeast(myAccess ?? undefined, 'manager');

  // Resolve each list's count: live query first, then the server-joined
  // task_count, else unknown (undefined → chip stays up top without a badge).
  const enriched = useMemo(
    () =>
      lists.map((l) => ({
        list: l,
        count: counts[l.id] ?? l.task_count,
      })),
    [lists, counts],
  );

  const withTasks = useMemo(() => enriched.filter((e) => e.count === undefined || e.count > 0), [enriched]);
  const emptyLists = useMemo(() => enriched.filter((e) => e.count === 0), [enriched]);

  // If the filtered list disappears (deleted / moved out), fall back to All.
  useEffect(() => {
    if (lists.length > 0 && value !== 'all' && !lists.some((l) => l.id === value)) {
      onChange('all');
    }
  }, [lists, value, onChange]);

  // Close the empty-lists popover on outside click / Escape.
  useEffect(() => {
    if (!emptyOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!emptyRef.current) return;
      if (!emptyRef.current.contains(e.target as Node)) setEmptyOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setEmptyOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [emptyOpen]);

  const activeIsEmpty = value !== 'all' && emptyLists.some((e) => e.list.id === value);
  const activeEmptyName = activeIsEmpty ? emptyLists.find((e) => e.list.id === value)?.list.name : null;

  const pickEmpty = (id: string) => {
    onChange(value === id ? 'all' : id);
    setEmptyOpen(false);
  };

  const clearDrag = () => {
    setDragId(null);
    setOver(null);
  };

  // Commit a drop: move `dragId` before/after the hovered chip, then hand the
  // full container order (empty lists appended in their current order) up.
  const commitDrop = (targetId: string, pos: 'before' | 'after') => {
    if (!onReorder || !dragId || dragId === targetId) {
      clearDrag();
      return;
    }
    const visibleIds = withTasks.map((t) => t.list.id);
    const emptyIds = emptyLists.map((e) => e.list.id);
    const from = visibleIds.indexOf(dragId);
    let to = visibleIds.indexOf(targetId) + (pos === 'before' ? 0 : 1);
    if (from < to) to -= 1; // account for the removal shift
    if (from !== -1 && to !== -1 && from !== to) {
      visibleIds.splice(from, 1);
      visibleIds.splice(to, 0, dragId);
      onReorder([...visibleIds, ...emptyIds]);
    }
    clearDrag();
  };

  const dragOverChip = (e: React.DragEvent, list: List) => {
    if (!canDragChips || !dragId || dragId === list.id) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setOver({ id: list.id, pos: e.clientX < rect.left + rect.width / 2 ? 'before' : 'after' });
  };

  // Forgiving drops: releases that land between chips (gaps, row background)
  // still commit — snap to the chip edge nearest the cursor.
  const rowRef = useRef<HTMLDivElement | null>(null);
  const nearestChip = (clientX: number): { id: string; pos: 'before' | 'after' } | null => {
    const els = Array.from(rowRef.current?.querySelectorAll<HTMLElement>('[data-chip-id]') ?? []);
    let best: { id: string; pos: 'before' | 'after'; dist: number } | null = null;
    for (const el of els) {
      const id = el.dataset.chipId!;
      if (!id || id === dragId) continue;
      const r = el.getBoundingClientRect();
      const mid = r.left + r.width / 2;
      const dist = Math.abs(clientX - mid);
      if (!best || dist < best.dist) best = { id, pos: clientX < mid ? 'before' : 'after', dist };
    }
    return best ? { id: best.id, pos: best.pos } : null;
  };

  return (
    <div
      className="sh-view dl-groupby shrink-0"
      ref={rowRef}
      onDragOver={(e) => {
        if (!canDragChips || !dragId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const n = nearestChip(e.clientX);
        if (n) setOver((prev) => (prev && prev.id === n.id && prev.pos === n.pos ? prev : n));
      }}
      onDrop={(e) => {
        if (!canDragChips || !dragId) {
          clearDrag();
          return;
        }
        e.preventDefault();
        const n = over && over.id !== dragId ? over : nearestChip(e.clientX);
        if (n) commitDrop(n.id, n.pos);
        else clearDrag();
      }}
    >
      <span className="dl-groupby-lbl">{label}</span>

      {/* All */}
      <div
        className="pill"
        data-active={value === 'all'}
        onClick={() => onChange('all')}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onChange('all');
          }
        }}
      >
        All
      </div>

      {/* Lists that hold tasks — compact chips with a live task count */}
      {withTasks.map(({ list, count }) => {
        // Only admin-locked lists are frozen; private ones reorder fine for
        // people who already manage this container (server enforces manager).
        const draggable = canDragChips && !list.is_locked;
        const isOverBefore = over?.id === list.id && over.pos === 'before';
        const isOverAfter = over?.id === list.id && over.pos === 'after';
        return (
          <div
            key={list.id}
            data-chip-id={list.id}
            className="group relative inline-flex"
            draggable={draggable}
            onDragStart={(e) => {
              if (!draggable) return;
              setDragId(list.id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', list.id);
            }}
            onDragOver={(e) => dragOverChip(e, list)}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              commitDrop(list.id, over?.id === list.id ? over.pos : 'after');
            }}
            onDragEnd={clearDrag}
          >
            <div
              className="lc-chip"
              data-grab={draggable}
              style={{
                ...(dragId === list.id ? { opacity: 0.4 } : null),
                ...(isOverBefore ? { boxShadow: 'inset 2px 0 0 var(--sh-ink)' } : null),
                ...(isOverAfter ? { boxShadow: 'inset -2px 0 0 var(--sh-ink)' } : null),
              }}
              data-active={value === list.id}
              title={`${list.name} · ${count ?? 0} task${count === 1 ? '' : 's'}`}
              onClick={() => onChange(value === list.id ? 'all' : list.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onChange(value === list.id ? 'all' : list.id);
                }
              }}
            >
              <span className="max-w-[160px] truncate">{list.name}</span>
              {list.is_private && !list.is_locked && <PrivateLock />}
              {list.is_locked && <AdminLock />}
              {count !== undefined && (
                <span className="lc-count" data-active={value === list.id}>
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </div>
            {canManageList(list) && (
              <button
                type="button"
                className="absolute -right-1.5 -top-1.5 hidden rounded-full border border-[var(--sh-hair)] bg-[var(--surface)] p-[1px] text-[var(--sh-ink-4)] shadow-sm transition hover:text-[var(--sh-ink)] group-hover:block"
                title="List settings"
                aria-label={`Settings for ${list.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setSettingsList(list);
                }}
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="12" cy="19" r="1.8" />
                </svg>
              </button>
            )}
          </div>
        );
      })}

      {/* Empty lists collapse into a dropdown */}
      {(emptyLists.length > 0 || activeIsEmpty) && (
        <div ref={emptyRef} className="relative">
          <div
            className="lc-chip lc-chip-empty"
            data-active={activeIsEmpty}
            onClick={() => setEmptyOpen((v) => !v)}
            role="button"
            tabIndex={0}
            aria-expanded={emptyOpen}
            aria-haspopup="menu"
            title="Lists with no tasks"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setEmptyOpen((v) => !v);
              }
            }}
          >
            {activeEmptyName ? (
              <>
                <span className="max-w-[160px] truncate">{activeEmptyName}</span>
                <svg className="h-3 w-3 shrink-0 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </>
            ) : (
              <>
                <span>Empty lists</span>
                <span className="lc-count">{emptyLists.length}</span>
                <svg
                  className={`h-3 w-3 shrink-0 opacity-60 transition-transform ${emptyOpen ? 'rotate-180' : ''}`}
                  viewBox="0 0 18 18"
                  fill="currentColor"
                >
                  <path d="M5 7h8L9 11z" />
                </svg>
              </>
            )}
          </div>

          {emptyOpen && (
            <div
              role="menu"
              aria-label="Empty lists"
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                left: 0,
                zIndex: 50,
                minWidth: 200,
                maxHeight: 264,
                overflowY: 'auto',
                background: 'var(--surface)',
                border: '1px solid var(--sh-hair)',
                borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
                padding: 4,
              }}
            >
              {emptyLists.map(({ list }) => (
                <div key={list.id} className="group/em relative flex items-center">
                  <div
                    role="menuitem"
                    tabIndex={0}
                    onClick={() => pickEmpty(list.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        pickEmpty(list.id);
                      }
                    }}
                    className="flex flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-[6px] text-left text-[12px] text-[var(--sh-ink-2)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
                  >
                    {list.is_private && !list.is_locked && <PrivateLock />}
                    {list.is_locked && <AdminLock />}
                    <span className="flex-1 truncate">{list.name}</span>
                    {value === list.id && (
                      <svg className="h-3.5 w-3.5 shrink-0 text-[var(--sh-ink)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                  </div>
                  {canManageList(list) && (
                    <button
                      type="button"
                      className="mr-1 hidden rounded p-0.5 text-[var(--sh-ink-4)] transition hover:text-[var(--sh-ink)] group-hover/em:block"
                      title="List settings"
                      aria-label={`Settings for ${list.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSettingsList(list);
                        setEmptyOpen(false);
                      }}
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="5" r="1.8" />
                        <circle cx="12" cy="12" r="1.8" />
                        <circle cx="12" cy="19" r="1.8" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Same settings slider the left sidebar opens — favorite/tag, move, rename, delete */}
      {settingsList && typeof document !== 'undefined' && createPortal((
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setSettingsList(null)} />
          <div
            className="fixed inset-y-0 right-0 left-auto z-50 flex h-full w-[360px] shrink-0 flex-col border-l border-[var(--sh-hair)] bg-[var(--surface)] shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <SettingsSlider
              type="list"
              id={settingsList.id}
              name={settingsList.name}
              spaceId={settingsList.space_id}
              folderId={settingsList.folder_id}
              groupTasks={settingsList.group_tasks}
              autoAssigneeIds={settingsList.auto_assignee_ids}
              myAccess={myAccess}
              onClose={() => {
                setSettingsList(null);
                onSettingsClosed?.();
              }}
            />
          </div>
        </>
      ), document.body)}
    </div>
  );
}

function PrivateLock() {
  return (
    <svg className="h-3 w-3 shrink-0 text-[var(--sh-ink-4)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}

function AdminLock() {
  return (
    <svg className="h-3 w-3 shrink-0 text-amber-500" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
    </svg>
  );
}
