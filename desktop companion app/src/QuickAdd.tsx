import { useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAuthStore } from './stores/authStore';
import {
  fetchPersonalList,
  fetchWorkspaces,
  fetchSpaces,
  fetchSpace,
  fetchAssignableUsers,
  createTask,
  setTaskFocus,
  uploadTaskAttachment,
  type AssignableUser,
  type ListLite,
  type TaskPriority,
} from './services/api';
import { getRecentLists, pushRecentList, type RecentList } from './services/recents';

// Cached across summons of the (persistent) quickadd window so we only resolve
// the personal list / list tree once per app run.
let cachedPersonal: { id: string; name: string } | null = null;

type Phase = 'idle' | 'saving' | 'uploading' | 'done' | 'error';
type MenuKey = 'list' | 'assignee' | 'priority' | 'date' | null;
type SelectedList = { id: string; name: string };

// A file the user has dropped onto the panel, queued to upload once the task
// itself is created. `previewUrl` is an object URL for images (revoked on
// removal/reset) and null for everything else.
type PendingAttachment = { id: string; file: File; previewUrl: string | null };
let attachmentSeq = 0;

const PRIORITIES: { value: TaskPriority; label: string; color: string }[] = [
  { value: 'emergency', label: 'Emergency', color: '#dc2626' },
  { value: 'urgent', label: 'Urgent', color: '#f97316' },
  { value: 'high', label: 'High', color: '#eab308' },
  { value: 'normal', label: 'Normal', color: '#3b82f6' },
  { value: 'low', label: 'Low', color: '#9ca3af' },
  { value: 'none', label: 'No priority', color: '#6b7280' },
];

// ── date helpers ────────────────────────────────────────────────────────────
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayYmd(): string {
  return ymd(new Date());
}
function tomorrowYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return ymd(d);
}
function dateLabel(s: string | null): string {
  if (!s) return 'Work date';
  if (s === todayYmd()) return 'Today';
  if (s === tomorrowYmd()) return 'Tomorrow';
  return new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function initials(name: string | null | undefined, email?: string): string {
  const src = (name && name.trim()) || (email && email.trim()) || '?';
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

// ── pickable-list tree (lazy, cached for the app run) ─────────────────────────
type PickableList = { id: string; name: string; spaceName: string; folderName: string | null };
let pickCache: PickableList[] | null = null;

const ACCESS_RANK = { viewer: 0, commenter: 1, member: 2, manager: 3 } as const;
function canPick(l: ListLite): boolean {
  if (l.is_locked) return false;
  if (!l.my_access_level) return true; // inherits from space; server enforces on POST
  return ACCESS_RANK[l.my_access_level] >= ACCESS_RANK.member;
}

async function loadPickableLists(): Promise<PickableList[]> {
  if (pickCache) return pickCache;
  const workspaces = await fetchWorkspaces();
  const wid = workspaces[0]?.id;
  if (!wid) return [];
  const spaces = await fetchSpaces(wid);
  const details = await Promise.all(spaces.map((s) => fetchSpace(s.id).catch(() => null)));
  const out: PickableList[] = [];
  for (const full of details) {
    if (!full) continue;
    const add = (l: ListLite, folderName: string | null) => {
      if (canPick(l)) out.push({ id: l.id, name: l.name, spaceName: full.name, folderName });
    };
    for (const l of full.lists || []) add(l, null);
    for (const f of full.folders || []) for (const l of f.lists || []) add(l, f.name);
  }
  pickCache = out;
  return out;
}

export default function QuickAdd() {
  const inputRef = useRef<HTMLInputElement>(null);
  const defaultListRef = useRef<SelectedList | null>(cachedPersonal);
  const win = getCurrentWindow();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [descOpen, setDescOpen] = useState(false);
  const [priority, setPriority] = useState<TaskPriority>('none');
  const [workDate, setWorkDate] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [selectedList, setSelectedList] = useState<SelectedList | null>(cachedPersonal);
  const [recents, setRecents] = useState<RecentList[]>([]);
  const [assignable, setAssignable] = useState<AssignableUser[]>([]);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [openMenu, setOpenMenu] = useState<MenuKey>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);

  // Once the task is created we keep its id so a retry (e.g. after an attachment
  // upload fails) re-uses it instead of creating a duplicate task.
  const createdTaskRef = useRef<{ id: string } | null>(null);
  // dragenter/dragleave fire per-child; count depth so we only clear the drop
  // highlight when the cursor truly leaves the panel.
  const dragDepthRef = useRef(0);
  // True while a drag is hovering the panel — used to suppress the dismiss-on-
  // blur behaviour, since dragging a file in from another app blurs us first.
  const draggingRef = useRef(false);
  const hideTimerRef = useRef<number | null>(null);

  const cancelPendingHide = () => {
    if (hideTimerRef.current != null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const clearAttachments = () => {
    setAttachments((cur) => {
      for (const a of cur) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      return [];
    });
  };

  const reset = () => {
    setTitle('');
    setDescription('');
    setDescOpen(false);
    setPriority('none');
    setWorkDate(null);
    setFocused(false);
    setOpenMenu(null);
    setPhase('idle');
    setError('');
    clearAttachments();
    createdTaskRef.current = null;
    dragDepthRef.current = 0;
    draggingRef.current = false;
    setDragOver(false);
    const self = useAuthStore.getState().userId;
    setAssigneeIds(self ? [self] : []);
    if (defaultListRef.current) setSelectedList(defaultListRef.current);
    void getRecentLists().then(setRecents);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const resolvePersonal = async () => {
    try {
      if (!cachedPersonal) {
        const p = await fetchPersonalList();
        cachedPersonal = { id: p.list.id, name: 'My Tasks' };
      }
      defaultListRef.current = cachedPersonal;
      setSelectedList((prev) => prev ?? cachedPersonal);
    } catch {
      /* surfaced on submit if it matters */
    }
  };

  useEffect(() => {
    // The quickadd webview is its own JS context — hydrate auth from the shared
    // store file (auth.json) so we have the latest tokens / userId.
    useAuthStore.getState().hydrate();
    void resolvePersonal();
    reset();

    // Rust emits this on EVERY summon (hotkey or tray). It's the authoritative
    // "start a fresh task" signal — tauri://focus alone is unreliable for a
    // non-activating NSPanel, which would leave the previously-added task in the
    // fields when the panel is reopened.
    const unlistenShow = win.listen('quickadd:show', () => {
      cancelPendingHide();
      useAuthStore.getState().hydrate();
      void resolvePersonal();
      reset();
    });

    const unlisten = win.onFocusChanged(({ payload: isFocused }) => {
      if (isFocused) {
        cancelPendingHide();
        useAuthStore.getState().hydrate();
        void resolvePersonal();
        reset();
      } else {
        // Spotlight behaviour: dismiss when focus is lost — but defer briefly.
        // Starting a file-drag from another app (Finder, a browser) blurs this
        // panel a moment before the drag actually enters it; the grace window
        // lets that drag arrive (which sets draggingRef) so we don't vanish
        // mid-drag.
        cancelPendingHide();
        hideTimerRef.current = window.setTimeout(() => {
          hideTimerRef.current = null;
          if (!draggingRef.current) void win.hide();
        }, 200);
      }
    });

    return () => {
      cancelPendingHide();
      void unlisten.then((fn) => fn());
      void unlistenShow.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load assignable users whenever the target list changes; default to self.
  useEffect(() => {
    const lid = selectedList?.id;
    if (!lid) {
      setAssignable([]);
      return;
    }
    let alive = true;
    fetchAssignableUsers(lid)
      .then((users) => {
        if (!alive) return;
        setAssignable(users);
        const self = useAuthStore.getState().userId;
        setAssigneeIds(self && users.some((u) => u.id === self) ? [self] : []);
      })
      .catch(() => {
        if (alive) {
          setAssignable([]);
          setAssigneeIds([]);
        }
      });
    return () => {
      alive = false;
    };
  }, [selectedList?.id]);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || phase === 'saving' || phase === 'uploading') return;

    if (!useAuthStore.getState().accessToken) {
      setPhase('error');
      setError('Sign in from the SquadHub menu-bar app first.');
      return;
    }

    let list = selectedList;
    if (!list) {
      try {
        if (!cachedPersonal) {
          const p = await fetchPersonalList();
          cachedPersonal = { id: p.list.id, name: 'My Tasks' };
        }
        list = cachedPersonal;
      } catch {
        setPhase('error');
        setError('Could not resolve your list. Try again.');
        return;
      }
    }

    setPhase('saving');
    setError('');
    try {
      // Re-use the already-created task on a retry (e.g. an attachment upload
      // failed last time) so we never create a duplicate.
      let task = createdTaskRef.current;
      if (!task) {
        task = await createTask({
          list_id: list.id,
          title: trimmed,
          description: description.trim() || undefined,
          priority: priority === 'none' ? undefined : priority,
          work_date: workDate || undefined,
          assignee_ids: assigneeIds.length ? assigneeIds : undefined,
        });
        createdTaskRef.current = task;
        if (focused) {
          try {
            await setTaskFocus(task.id, true);
          } catch {
            /* focus is a nice-to-have; don't fail the whole add */
          }
        }
        if (!cachedPersonal || list.id !== cachedPersonal.id) {
          void pushRecentList({ id: list.id, name: list.name });
        }
      }

      // Upload any dropped files; keep the ones that fail queued so the next
      // Enter / Add retries only those (the task already exists).
      if (attachments.length) {
        setPhase('uploading');
        const failed: PendingAttachment[] = [];
        for (const a of attachments) {
          try {
            await uploadTaskAttachment(task.id, a.file);
            if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
          } catch {
            failed.push(a);
          }
        }
        if (failed.length) {
          setAttachments(failed);
          setPhase('error');
          setError(
            `Task added, but ${failed.length} ${failed.length === 1 ? 'file' : 'files'} failed to upload — press Enter to retry.`,
          );
          return;
        }
        setAttachments([]);
      }

      setPhase('done');
      setTimeout(() => {
        void win.hide();
      }, 550);
    } catch (e) {
      // A stale cached id (e.g. list deleted) — clear so the next try re-resolves.
      if (!selectedList) cachedPersonal = null;
      pickCache = null;
      setPhase('error');
      setError(e instanceof Error ? e.message : 'Could not add task');
    }
  };

  const onContainerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (openMenu) setOpenMenu(null);
      else void win.hide();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  const onTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      void submit();
    }
  };

  const toggleMenu = (key: Exclude<MenuKey, null>) =>
    setOpenMenu((cur) => (cur === key ? null : key));
  const pickList = (l: SelectedList) => {
    setSelectedList(l);
    setOpenMenu(null);
  };
  const toggleAssignee = (id: string) =>
    setAssigneeIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  // ── dropped-file attachments ───────────────────────────────────────────────
  const queueFiles = (files: FileList | File[]) => {
    const next: PendingAttachment[] = [];
    for (const file of Array.from(files)) {
      if (!file) continue;
      next.push({
        id: `att-${attachmentSeq++}`,
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      });
    }
    if (next.length) setAttachments((cur) => [...cur, ...next]);
  };

  const removeAttachment = (id: string) =>
    setAttachments((cur) => {
      const hit = cur.find((a) => a.id === id);
      if (hit?.previewUrl) URL.revokeObjectURL(hit.previewUrl);
      return cur.filter((a) => a.id !== id);
    });

  const onDragEnter = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    draggingRef.current = true;
    cancelPendingHide();
    setDragOver(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    draggingRef.current = true;
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      draggingRef.current = false;
      setDragOver(false);
    }
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    draggingRef.current = false;
    setDragOver(false);
    if (e.dataTransfer.files?.length) queueFiles(e.dataTransfer.files);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // ── chips: My Tasks + up to 3 recents (+ current selection if off-list) ─────
  const personalId = cachedPersonal?.id;
  const chips: SelectedList[] = [];
  if (defaultListRef.current) chips.push({ id: defaultListRef.current.id, name: 'My Tasks' });
  for (const r of recents) {
    if (r.id === personalId) continue;
    if (chips.length >= 4) break;
    chips.push(r);
  }
  if (selectedList && !chips.some((c) => c.id === selectedList.id)) {
    chips.splice(1, 0, selectedList);
  }

  const selectedPriority = PRIORITIES.find((p) => p.value === priority)!;
  const assigneeLabel =
    assigneeIds.length === 0
      ? 'Assignee'
      : assigneeIds.length === 1
        ? assignable.find((u) => u.id === assigneeIds[0])?.display_name ||
          assignable.find((u) => u.id === assigneeIds[0])?.email ||
          '1 assignee'
        : `${assigneeIds.length} assignees`;

  return (
    <div
      className="qa-scroll"
      onKeyDown={onContainerKeyDown}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className={`qa${dragOver ? ' qa-drop-active' : ''}`}>
        {dragOver && <div className="qa-drop-overlay">Drop image to attach</div>}
      <div className="qa-row">
        <span className="qa-icon">+</span>
        <input
          ref={inputRef}
          className="qa-input"
          placeholder="Add a task…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onTitleKeyDown}
          autoFocus
          disabled={phase === 'saving'}
        />
      </div>

      {/* List chips */}
      <div className="qa-chips">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`qa-chip${selectedList?.id === c.id ? ' active' : ''}`}
            onClick={() => pickList(c)}
            title={c.name}
          >
            {c.id === personalId ? '★ ' : ''}
            {c.name}
          </button>
        ))}
        <button
          type="button"
          className={`qa-chip qa-chip-more${openMenu === 'list' ? ' active' : ''}`}
          onClick={() => toggleMenu('list')}
        >
          More…
        </button>
      </div>

      {/* Attribute pills */}
      <div className="qa-attrs">
        <button
          type="button"
          className={`qa-pill${assigneeIds.length ? ' active' : ' muted'}`}
          onClick={() => toggleMenu('assignee')}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span className="qa-pill-label">{assigneeLabel}</span>
        </button>

        <button
          type="button"
          className={`qa-pill${priority !== 'none' ? ' active' : ' muted'}`}
          onClick={() => toggleMenu('priority')}
        >
          <span className="qa-dot" style={{ background: selectedPriority.color }} />
          <span className="qa-pill-label">{priority === 'none' ? 'Priority' : selectedPriority.label}</span>
        </button>

        <button
          type="button"
          className={`qa-pill${workDate ? ' active' : ' muted'}`}
          onClick={() => toggleMenu('date')}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
          <span className="qa-pill-label">{dateLabel(workDate)}</span>
        </button>

        <button
          type="button"
          className={`qa-pill qa-star${focused ? ' active' : ' muted'}`}
          onClick={() => setFocused((v) => !v)}
          title="Focus star"
        >
          {focused ? '★' : '☆'}
        </button>

        <button
          type="button"
          className={`qa-pill${descOpen || description ? ' active' : ' muted'}`}
          onClick={() => setDescOpen((v) => !v)}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h16M4 12h16M4 18h10" />
          </svg>
          <span className="qa-pill-label">Description</span>
        </button>
      </div>

      {descOpen && (
        <div className="qa-desc">
          <textarea
            className="qa-textarea"
            placeholder="Add a description…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </div>
      )}

      {/* Inline menus (one at a time; they push content down so nothing clips) */}
      {openMenu === 'list' && <ListPicker onPick={pickList} />}

      {openMenu === 'priority' && (
        <div className="qa-menu">
          <div className="qa-menu-scroll">
            {PRIORITIES.map((p) => (
              <button
                key={p.value}
                type="button"
                className="qa-opt-row"
                onClick={() => {
                  setPriority(p.value);
                  setOpenMenu(null);
                }}
              >
                <span className="qa-dot" style={{ background: p.color }} />
                <span className="qa-opt-main">{p.label}</span>
                {priority === p.value && <span className="qa-check">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {openMenu === 'assignee' && (
        <div className="qa-menu">
          <div className="qa-menu-scroll">
            {assignable.length === 0 ? (
              <div className="qa-menu-empty">No assignable members</div>
            ) : (
              assignable.map((u) => {
                const on = assigneeIds.includes(u.id);
                return (
                  <button key={u.id} type="button" className="qa-opt-row" onClick={() => toggleAssignee(u.id)}>
                    <span className="qa-avatar">{initials(u.display_name, u.email)}</span>
                    <span className="qa-opt-main">{u.display_name || u.email}</span>
                    {on && <span className="qa-check">✓</span>}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {openMenu === 'date' && (
        <div className="qa-menu">
          <div className="qa-date-quick">
            <button type="button" className="qa-chip" onClick={() => { setWorkDate(todayYmd()); setOpenMenu(null); }}>
              Today
            </button>
            <button type="button" className="qa-chip" onClick={() => { setWorkDate(tomorrowYmd()); setOpenMenu(null); }}>
              Tomorrow
            </button>
            <button type="button" className="qa-chip" onClick={() => { setWorkDate(null); setOpenMenu(null); }}>
              No date
            </button>
            <input
              type="date"
              className="qa-date-input"
              value={workDate || ''}
              onChange={(e) => { setWorkDate(e.target.value || null); }}
            />
          </div>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="qa-attachments">
          {attachments.map((a) => (
            <div key={a.id} className="qa-att" title={a.file.name}>
              {a.previewUrl ? (
                <img className="qa-att-thumb" src={a.previewUrl} alt={a.file.name} />
              ) : (
                <div className="qa-att-thumb qa-att-file">📎</div>
              )}
              <span className="qa-att-name">{a.file.name}</span>
              <button
                type="button"
                className="qa-att-remove"
                onClick={() => removeAttachment(a.id)}
                title="Remove"
                aria-label={`Remove ${a.file.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="qa-footer">
        <div className="qa-hint">
          {phase === 'saving' && <span>Adding…</span>}
          {phase === 'uploading' && <span>Uploading attachment…</span>}
          {phase === 'done' && <span className="qa-ok">Added ✓</span>}
          {phase === 'error' && <span className="qa-err">{error}</span>}
          {phase === 'idle' && (
            <span>
              <b>Enter</b> to add · <b>Esc</b> to dismiss
            </span>
          )}
        </div>
        <button
          type="button"
          className="qa-add-btn"
          onClick={() => void submit()}
          disabled={!title.trim() || phase === 'saving' || phase === 'uploading'}
        >
          Add a Task
        </button>
      </div>
      </div>
    </div>
  );
}

// ── list picker (search across all spaces/folders the user can post to) ───────
function ListPicker({ onPick }: { onPick: (l: SelectedList) => void }) {
  const [query, setQuery] = useState('');
  const [lists, setLists] = useState<PickableList[] | null>(pickCache);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (lists) return;
    let alive = true;
    loadPickableLists()
      .then((r) => alive && setLists(r))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : 'Failed to load lists'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = query.trim().toLowerCase();
  const matches = (lists || []).filter(
    (l) =>
      !q ||
      l.name.toLowerCase().includes(q) ||
      l.spaceName.toLowerCase().includes(q) ||
      (l.folderName || '').toLowerCase().includes(q),
  );

  return (
    <div className="qa-menu">
      <input
        className="qa-search"
        autoFocus
        placeholder="Search lists…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="qa-menu-scroll">
        {err && <div className="qa-menu-empty">{err}</div>}
        {!err && !lists && <div className="qa-menu-empty">Loading lists…</div>}
        {!err && lists && matches.length === 0 && <div className="qa-menu-empty">No lists found</div>}
        {matches.map((l) => (
          <button key={l.id} type="button" className="qa-opt" onClick={() => onPick({ id: l.id, name: l.name })}>
            <span className="qa-opt-main">{l.name}</span>
            <span className="qa-opt-sub">{l.folderName ? `${l.spaceName} / ${l.folderName}` : l.spaceName}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
