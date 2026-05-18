import { useEffect, useMemo, useRef, useState } from 'react';
import { usePMStore } from '../../stores/pmStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useWorkspaceSearch, type SearchTask } from '../../hooks/useWorkspaceSearch';
import type { HomeView } from '../../layouts/MainLayout';

type ResultKind = 'space' | 'folder' | 'list' | 'task' | 'channel' | 'member';

interface ResultBase {
  key: string;
  kind: ResultKind;
  label: string;
  hint?: string;
}

interface SpaceResult extends ResultBase {
  kind: 'space';
  spaceId: string;
}
interface FolderResult extends ResultBase {
  kind: 'folder';
  spaceId: string;
  folderId: string;
}
interface ListResult extends ResultBase {
  kind: 'list';
  spaceId: string;
  listId: string;
}
interface TaskResult extends ResultBase {
  kind: 'task';
  task: SearchTask;
}
interface ChannelResult extends ResultBase {
  kind: 'channel';
  channelId: string;
}
interface MemberResult extends ResultBase {
  kind: 'member';
  memberId: string;
}

type Result =
  | SpaceResult
  | FolderResult
  | ListResult
  | TaskResult
  | ChannelResult
  | MemberResult;

interface SearchPaletteProps {
  workspaceId: string;
  onClose: () => void;
  setHomeView: (v: HomeView) => void;
}

function CategoryIcon({ kind }: { kind: ResultKind }) {
  const cls = 'h-[14px] w-[14px] shrink-0';
  switch (kind) {
    case 'space':
      return (
        <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      );
    case 'folder':
      return (
        <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      );
    case 'list':
      return (
        <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      );
    case 'task':
      return (
        <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="m8.5 12.5 2.5 2.5 4.5-5" />
        </svg>
      );
    case 'channel':
      return (
        <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
        </svg>
      );
    case 'member':
      return (
        <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0116 0" />
        </svg>
      );
  }
}

const CATEGORY_LABEL: Record<ResultKind, string> = {
  space: 'Spaces',
  folder: 'Folders',
  list: 'Lists',
  task: 'Tasks',
  channel: 'Channels',
  member: 'People',
};

export default function SearchPalette({ workspaceId, onClose, setHomeView }: SearchPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const setActiveSpace = usePMStore((s) => s.setActiveSpace);
  const setActiveSpacePage = usePMStore((s) => s.setActiveSpacePage);
  const setActiveFolder = usePMStore((s) => s.setActiveFolder);
  const setActiveList = usePMStore((s) => s.setActiveList);
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const setActiveChannel = useWorkspaceStore((s) => s.setActiveChannel);

  const { spaces, folders, lists, tasks, channels, members, isLoading } = useWorkspaceSearch(
    workspaceId,
    query,
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Build a flat ordered list of results (for arrow-key navigation)
  const flatResults: Result[] = useMemo(() => {
    const out: Result[] = [];
    for (const s of spaces) {
      out.push({ key: `space:${s.id}`, kind: 'space', label: s.name, spaceId: s.id });
    }
    for (const f of folders) {
      out.push({
        key: `folder:${f.id}`,
        kind: 'folder',
        label: f.name,
        hint: f.space_name ?? undefined,
        spaceId: f.space_id,
        folderId: f.id,
      });
    }
    for (const l of lists) {
      const hint = [l.space_name, l.folder_name].filter(Boolean).join(' › ') || undefined;
      out.push({
        key: `list:${l.id}`,
        kind: 'list',
        label: l.name,
        hint,
        spaceId: l.space_id,
        listId: l.id,
      });
    }
    for (const t of tasks) {
      const hint = [t.space_name, t.folder_name, t.list_name].filter(Boolean).join(' › ') || undefined;
      out.push({
        key: `task:${t.id}`,
        kind: 'task',
        label: t.title,
        hint,
        task: t,
      });
    }
    for (const c of channels) {
      out.push({ key: `channel:${c.id}`, kind: 'channel', label: `#${c.name}`, channelId: c.id });
    }
    for (const m of members) {
      out.push({
        key: `member:${m.id}`,
        kind: 'member',
        label: m.display_name,
        hint: m.email,
        memberId: m.id,
      });
    }
    return out;
  }, [spaces, folders, lists, tasks, channels, members]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Scroll active result into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-result-index="${activeIndex}"]`);
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function') {
      (el as HTMLElement).scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  const handleSelect = (r: Result) => {
    switch (r.kind) {
      case 'space':
        setActiveSpace(r.spaceId);
        setActiveSpacePage(r.spaceId);
        setHomeView('hub');
        break;
      case 'folder':
        setActiveSpace(r.spaceId);
        setActiveFolder(r.folderId);
        setHomeView('tasks');
        break;
      case 'list':
        setActiveSpace(r.spaceId);
        setActiveList(r.listId);
        setHomeView('tasks');
        break;
      case 'task': {
        const t = r.task;
        if (t.space_id) setActiveSpace(t.space_id);
        setActiveList(t.list_id);
        setActiveTask(t.id);
        setHomeView('tasks');
        break;
      }
      case 'channel':
        setActiveChannel(r.channelId);
        setHomeView('chat');
        break;
      case 'member':
        // DMs aren't wired in this app yet; close palette as a no-op for now.
        break;
    }
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(flatResults.length - 1, 0)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = flatResults[activeIndex];
      if (r) handleSelect(r);
      return;
    }
  };

  // Group flat results back by category for rendered headings (but keep the same indices)
  const groupedSections: { kind: ResultKind; items: { result: Result; index: number }[] }[] = useMemo(() => {
    const order: ResultKind[] = ['space', 'folder', 'list', 'task', 'channel', 'member'];
    const map = new Map<ResultKind, { result: Result; index: number }[]>();
    flatResults.forEach((r, idx) => {
      if (!map.has(r.kind)) map.set(r.kind, []);
      map.get(r.kind)!.push({ result: r, index: idx });
    });
    return order
      .filter((k) => (map.get(k)?.length ?? 0) > 0)
      .map((k) => ({ kind: k, items: map.get(k)! }));
  }, [flatResults]);

  const hasResults = flatResults.length > 0;
  const showEmpty = query.trim().length > 0 && !hasResults && !isLoading;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[14vh]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        aria-hidden
      />
      <div
        className="relative z-[1] w-full max-w-[640px] overflow-hidden rounded-xl border border-[var(--sh-hair)] bg-[var(--surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input row */}
        <div className="flex items-center gap-2 border-b border-[var(--sh-hair)] px-3 py-2.5">
          <svg className="h-4 w-4 shrink-0 text-[var(--sh-ink-4)]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search spaces, lists, tasks, people…"
            className="flex-1 bg-transparent text-[14px] text-[var(--sh-ink)] outline-none placeholder:text-[var(--sh-ink-4)]"
          />
          <button
            onClick={onClose}
            className="rounded border border-[var(--sh-hair)] bg-[var(--sh-hair-3)] px-1.5 py-[1px] text-[10px] text-[var(--sh-ink-4)]"
            type="button"
            aria-label="Close search"
          >
            Esc
          </button>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-1">
          {query.trim().length === 0 && (
            <div className="px-4 py-6 text-center text-[12.5px] text-[var(--sh-ink-4)]">
              Start typing to search the workspace.
            </div>
          )}

          {showEmpty && (
            <div className="px-4 py-6 text-center text-[12.5px] text-[var(--sh-ink-4)]">
              No results for &ldquo;{query}&rdquo;
            </div>
          )}

          {groupedSections.map(({ kind, items }) => (
            <div key={kind} className="pb-1.5">
              <div className="px-3 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--sh-ink-4)]">
                {CATEGORY_LABEL[kind]}
              </div>
              {items.map(({ result, index }) => {
                const isActive = index === activeIndex;
                return (
                  <button
                    type="button"
                    key={result.key}
                    data-result-index={index}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => handleSelect(result)}
                    className={`flex w-full items-center gap-2.5 px-3 py-[7px] text-left text-[13px] transition ${
                      isActive
                        ? 'bg-[var(--sh-hair-3)] text-[var(--sh-ink)]'
                        : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)]'
                    }`}
                  >
                    <span className={isActive ? 'text-[var(--sh-ink)]' : 'text-[var(--sh-ink-3)]'}>
                      <CategoryIcon kind={kind} />
                    </span>
                    <span className="truncate">{result.label}</span>
                    {result.hint && (
                      <span className="ml-auto truncate pl-3 text-[11.5px] text-[var(--sh-ink-4)]">
                        {result.hint}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between border-t border-[var(--sh-hair)] px-3 py-1.5 text-[10.5px] text-[var(--sh-ink-4)]">
          <span>{isLoading ? 'Searching…' : `${flatResults.length} result${flatResults.length === 1 ? '' : 's'}`}</span>
          <span className="flex items-center gap-2">
            <kbd className="rounded border border-[var(--sh-hair)] bg-[var(--sh-hair-3)] px-1 py-[1px]">↑↓</kbd>
            navigate
            <kbd className="rounded border border-[var(--sh-hair)] bg-[var(--sh-hair-3)] px-1 py-[1px]">↵</kbd>
            select
          </span>
        </div>
      </div>
    </div>
  );
}
