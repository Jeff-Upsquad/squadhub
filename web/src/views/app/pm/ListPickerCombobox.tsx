import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import api from '../../../services/api';
import { useSpaces, useSpace } from '../../../hooks/useSpaces';
import type { AccessLevel, Folder, List, Space } from '@squadhub/shared';

const ACCESS_RANK: Record<AccessLevel, number> = {
  viewer: 0,
  commenter: 1,
  member: 2,
  manager: 3,
};

// GET /pm/spaces/:id hydrates my_access_level only on the space, not on nested lists/folders —
// so absence of a level means "inherit from space" here, not "no access". Server enforces on POST.
function canPickList(level: AccessLevel | undefined, isLocked: boolean | undefined): boolean {
  if (isLocked) return false;
  if (!level) return true;
  return ACCESS_RANK[level] >= ACCESS_RANK.member;
}

type Flat = { list: List; space: Space; folderName: string | null };

function flattenPickable(spaces: (Space | undefined)[]): Flat[] {
  const out: Flat[] = [];
  for (const s of spaces) {
    if (!s) continue;
    for (const l of s.lists || []) {
      if (canPickList(l.my_access_level, l.is_locked)) out.push({ list: l, space: s, folderName: null });
    }
    for (const f of s.folders || []) {
      for (const l of f.lists || []) {
        if (canPickList(l.my_access_level, l.is_locked)) out.push({ list: l, space: s, folderName: f.name });
      }
    }
  }
  return out;
}

function spaceInitial(name: string | undefined | null): string {
  if (!name) return '?';
  return name.trim().charAt(0).toUpperCase() || '?';
}

export default function ListPickerCombobox({
  workspaceId,
  selectedListId,
  selectedListName,
  selectedSpaceColor,
  initialSpaceId,
  onChange,
  renderTrigger,
  open: openProp,
  onOpenChange,
}: {
  workspaceId: string;
  selectedListId: string | null;
  selectedListName?: string | null;
  selectedSpaceColor?: string | null;
  initialSpaceId?: string | null;
  onChange: (listId: string, spaceId: string) => void;
  renderTrigger?: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  /** Controlled open state. When provided, the parent owns open/close (e.g. the
   *  task panel opens the picker from its ⋯ menu); otherwise the trigger toggles
   *  an internal state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { data: spaces } = useSpaces(workspaceId);
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp !== undefined ? openProp : openInternal;
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next;
    onOpenChange?.(value);
    if (openProp === undefined) setOpenInternal(value);
  };
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    if (initialSpaceId) init[initialSpaceId] = true;
    return init;
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // Focus search when opened
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // When searching, eagerly expand every space so its data is fetched
  const searching = query.trim().length > 0;
  useEffect(() => {
    if (!open || !searching || !spaces) return;
    setExpanded((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const s of spaces) {
        if (!next[s.id]) {
          next[s.id] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [open, searching, spaces]);

  const pick = (listId: string, spaceId: string) => {
    onChange(listId, spaceId);
    setOpen(false);
    setQuery('');
  };

  const toggle = () => setOpen((v) => !v);

  return (
    <div ref={containerRef} className="relative inline-block">
      {renderTrigger ? (
        renderTrigger({ open, toggle })
      ) : (
        <button
          type="button"
          onClick={toggle}
          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] text-[color:var(--sh-ink)] hover:bg-[color:var(--sh-hair-3)] transition"
          style={{ borderColor: 'var(--sh-hair)', background: 'var(--surface)' }}
        >
          <span
            className="grid h-4 w-4 place-items-center rounded-[4px] text-[9px] font-semibold text-white"
            style={{ background: selectedSpaceColor || 'var(--sh-ink)' }}
            aria-hidden
          >
            {selectedListName ? 'L' : '·'}
          </span>
          <span className="max-w-[220px] truncate">
            {selectedListName || 'Choose list…'}
          </span>
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="text-[color:var(--sh-ink-4)]"
          >
            <path d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
          </svg>
        </button>
      )}

      {open && (
        <div
          className="absolute left-0 top-full z-[100] mt-1 w-[340px] overflow-hidden rounded-xl border shadow-xl"
          style={{ borderColor: 'var(--sh-hair)', background: 'var(--surface)' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="p-3">
            <div
              className="flex items-center gap-2 rounded-md border px-2 py-1.5"
              style={{ borderColor: 'var(--sh-hair)', background: 'var(--surface)' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[color:var(--sh-ink-4)]">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-[color:var(--sh-ink-4)]"
              />
            </div>
          </div>

          <div className="max-h-[360px] overflow-y-auto px-2 pb-3">
            {searching ? (
              <SearchResults
                spaces={spaces || []}
                query={query.trim().toLowerCase()}
                selectedListId={selectedListId}
                onPick={pick}
              />
            ) : (
              <>
                <div className="px-2 pt-1 pb-1 text-[11px] uppercase tracking-wider text-[color:var(--sh-ink-4)]">
                  Spaces
                </div>
                {(spaces || []).map((s) => (
                  <SpaceNode
                    key={s.id}
                    space={s}
                    expanded={!!expanded[s.id]}
                    selectedListId={selectedListId}
                    onToggle={() =>
                      setExpanded((m) => ({ ...m, [s.id]: !m[s.id] }))
                    }
                    onPick={pick}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SpaceNode({
  space,
  expanded,
  selectedListId,
  onToggle,
  onPick,
}: {
  space: Space;
  expanded: boolean;
  selectedListId: string | null;
  onToggle: () => void;
  onPick: (listId: string, spaceId: string) => void;
}) {
  const { data: full } = useSpace(expanded ? space.id : null);
  const source = full || space; // show what we have; lists load in when `full` arrives

  const rootLists = (source.lists || []).filter((l) => canPickList(l.my_access_level, l.is_locked));
  const foldersWithLists = (source.folders || [])
    .map((f) => ({ folder: f, lists: (f.lists || []).filter((l) => canPickList(l.my_access_level, l.is_locked)) }))
    .filter((x) => x.lists.length > 0);

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[color:var(--sh-hair-3)]"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="text-[color:var(--sh-ink-4)] shrink-0"
        >
          <path d={expanded ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'} />
        </svg>
        <span
          className="grid h-5 w-5 place-items-center rounded-[5px] text-[10px] font-semibold text-white shrink-0"
          style={{ background: space.color || 'var(--sh-ink)' }}
        >
          {spaceInitial(space.name)}
        </span>
        <span className="flex-1 text-[13px] truncate">{space.name}</span>
        {space.is_locked && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-[color:var(--sh-ink-4)]">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 018 0v4" />
          </svg>
        )}
      </button>

      {expanded && (
        <div className="ml-3 border-l pl-2" style={{ borderColor: 'var(--sh-hair)' }}>
          {rootLists.map((l) => (
            <ListRow
              key={l.id}
              list={l}
              isSelected={l.id === selectedListId}
              onClick={() => onPick(l.id, space.id)}
            />
          ))}
          {foldersWithLists.map(({ folder, lists }) => (
            <FolderNode
              key={folder.id}
              folder={folder}
              lists={lists}
              selectedListId={selectedListId}
              onPickList={(l) => onPick(l.id, space.id)}
            />
          ))}
          {!full && (
            <div className="px-2 py-1 text-[11px] text-[color:var(--sh-ink-4)]">Loading…</div>
          )}
          {full && rootLists.length === 0 && foldersWithLists.length === 0 && (
            <div className="px-2 py-1 text-[11px] text-[color:var(--sh-ink-4)]">No lists you can post to</div>
          )}
        </div>
      )}
    </div>
  );
}

function FolderNode({
  folder,
  lists,
  selectedListId,
  onPickList,
}: {
  folder: Folder;
  lists: List[];
  selectedListId: string | null;
  onPickList: (list: List) => void;
}) {
  const [open, setOpen] = useState(() => lists.some((l) => l.id === selectedListId));
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[color:var(--sh-hair-3)]"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="text-[color:var(--sh-ink-4)] shrink-0"
        >
          <path d={open ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'} />
        </svg>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[color:var(--sh-ink-3)] shrink-0"
        >
          <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
        </svg>
        <span className="flex-1 text-[13px] truncate">{folder.name}</span>
      </button>
      {open && (
        <div className="ml-3 border-l pl-2" style={{ borderColor: 'var(--sh-hair)' }}>
          {lists.map((l) => (
            <ListRow
              key={l.id}
              list={l}
              isSelected={l.id === selectedListId}
              onClick={() => onPickList(l)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ListRow({
  list,
  isSelected,
  onClick,
  subtitle,
}: {
  list: List;
  isSelected: boolean;
  onClick: () => void;
  subtitle?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${
        isSelected
          ? 'bg-[color:rgba(34,197,94,0.12)] text-[#16a34a]'
          : 'hover:bg-[color:var(--sh-hair-3)]'
      }`}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
      </svg>
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] truncate">{list.name}</span>
        {subtitle && (
          <span className="block text-[11px] text-[color:var(--sh-ink-4)] truncate">{subtitle}</span>
        )}
      </span>
      {typeof list.task_count === 'number' && (
        <span className="text-[11px] text-[color:var(--sh-ink-4)] shrink-0">{list.task_count}</span>
      )}
      {isSelected && (
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <path d="M5 12l5 5 9-11" />
        </svg>
      )}
    </button>
  );
}

function SearchResults({
  spaces,
  query,
  selectedListId,
  onPick,
}: {
  spaces: Space[];
  query: string;
  selectedListId: string | null;
  onPick: (listId: string, spaceId: string) => void;
}) {
  // Fetch every space's full data in parallel; results are cached (same key as useSpace)
  const results = useQueries({
    queries: spaces.map((s) => ({
      queryKey: ['space', s.id],
      queryFn: async () => {
        const res = await api.get(`/pm/spaces/${s.id}`);
        return res.data.data as Space;
      },
    })),
  });
  const fulls = results.map((r) => r.data);
  const loading = results.some((r) => r.isLoading);
  const flat = useMemo(() => flattenPickable(fulls), [fulls]);
  const matches = flat.filter(({ list, space, folderName }) => {
    if (list.name.toLowerCase().includes(query)) return true;
    if (space.name.toLowerCase().includes(query)) return true;
    if (folderName && folderName.toLowerCase().includes(query)) return true;
    return false;
  });

  if (loading && matches.length === 0) {
    return (
      <div className="px-2 py-4 text-center text-[12px] text-[color:var(--sh-ink-4)]">
        Searching…
      </div>
    );
  }

  if (!matches.length) {
    return (
      <div className="px-2 py-4 text-center text-[12px] text-[color:var(--sh-ink-4)]">
        No lists match &ldquo;{query}&rdquo;
      </div>
    );
  }

  return (
    <div>
      {matches.map(({ list, space, folderName }) => (
        <ListRow
          key={list.id}
          list={list}
          isSelected={list.id === selectedListId}
          onClick={() => onPick(list.id, space.id)}
          subtitle={folderName ? `${space.name} / ${folderName}` : space.name}
        />
      ))}
    </div>
  );
}
