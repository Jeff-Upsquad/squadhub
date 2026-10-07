import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getTaskStatusDef, type SpaceStatus } from '@squadhub/shared';

const SPACE_STATUS_GROUP_CONFIG: { key: string; label: string; emoji: string }[] = [
  { key: 'priority_urgency', label: 'Priority & Urgency', emoji: '⚡' },
  { key: 'in_motion', label: 'In Motion', emoji: '🏃' },
  { key: 'up_next', label: 'Up Next', emoji: '🎯' },
  { key: 'scheduled_queued', label: 'Scheduled / Queued', emoji: '📅' },
  { key: 'routines', label: 'Routines', emoji: '🔁' },
  { key: 'blocked_paused', label: 'Blocked / Paused', emoji: '⏸️' },
  { key: 'not_started', label: 'Not Started', emoji: '📥' },
  { key: 'done', label: 'Closed', emoji: '✅' },
];

type Item = {
  status: SpaceStatus;
  description: string;
  groupKey: string;
  groupName: string;
  emoji: string;
};

function toSlug(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

export default function StatusPicker({
  anchorRect,
  statuses,
  currentStatus,
  onChange,
  onClose,
}: {
  anchorRect: DOMRect | null;
  statuses: SpaceStatus[];
  currentStatus?: string | null;
  onChange: (statusName: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onScrollOrResize = () => onClose();

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [onClose]);

  useEffect(() => {
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const displayStatuses: SpaceStatus[] =
    statuses && statuses.length > 0
      ? statuses
      : ([
          { id: 'todo', name: 'To Do', color: '#6b7280', category: 'todo' },
          { id: 'in_progress', name: 'In Progress', color: '#3b82f6', category: 'active' },
          { id: 'done', name: 'Done', color: '#10b981', category: 'done' },
        ] as unknown as SpaceStatus[]);

  const { grouped, flatList } = useMemo(() => {
    const q = search.trim().toLowerCase();

    const items: Item[] = displayStatuses.map((s) => {
      const slug = toSlug(s.name);
      const def = getTaskStatusDef(slug) || getTaskStatusDef(s.name.toLowerCase());
      let groupKey = def?.group;
      if (!groupKey) {
        if (s.category === 'todo') groupKey = 'not_started';
        else if (s.category === 'closed' || (s.category as string) === 'done') groupKey = 'done';
        else groupKey = 'in_motion';
      }
      const groupCfg = SPACE_STATUS_GROUP_CONFIG.find((c) => c.key === groupKey) || {
        key: groupKey,
        label: def?.groupLabel || (s.category === 'todo' ? 'Not Started' : s.category === 'closed' ? 'Closed' : 'In Motion'),
        emoji: def?.groupEmoji || '📋',
      };
      return {
        status: s,
        description: def?.description || '',
        groupKey,
        groupName: groupCfg.label,
        emoji: groupCfg.emoji,
      };
    });

    const filtered = items.filter((item) => {
      if (!q) return true;
      return (
        item.status.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.groupName.toLowerCase().includes(q)
      );
    });

    const groupsMap = new Map<string, { groupName: string; emoji: string; items: Item[] }>();
    for (const item of filtered) {
      const existing = groupsMap.get(item.groupKey);
      if (existing) existing.items.push(item);
      else groupsMap.set(item.groupKey, { groupName: item.groupName, emoji: item.emoji, items: [item] });
    }

    const sortedGroups: { groupName: string; emoji: string; items: Item[] }[] = [];
    for (const cfg of SPACE_STATUS_GROUP_CONFIG) {
      if (groupsMap.has(cfg.key)) {
        sortedGroups.push(groupsMap.get(cfg.key)!);
        groupsMap.delete(cfg.key);
      }
    }
    for (const [, grp] of groupsMap.entries()) sortedGroups.push(grp);

    const flat: Item[] = [];
    for (const g of sortedGroups) flat.push(...g.items);
    return { grouped: sortedGroups, flatList: flat };
  }, [displayStatuses, search]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [search]);

  if (!anchorRect || typeof document === 'undefined') return null;

  const width = 330;
  let left = anchorRect.left;
  if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
  if (left < 12) left = 12;
  const maxH = 420;
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const openUp = spaceBelow < 260 && anchorRect.top > spaceBelow;
  const top = openUp
    ? Math.max(8, anchorRect.top - maxH - 6)
    : Math.min(anchorRect.bottom + 6, window.innerHeight - 80);

  const isSelected = (s: SpaceStatus) =>
    s.name === currentStatus ||
    s.id === currentStatus ||
    s.name.toLowerCase() === (currentStatus || '').toLowerCase();

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev + 1 < flatList.length ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : flatList.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flatList[highlightedIndex];
      if (item) {
        onChange(item.status.name);
        onClose();
      }
    }
  };

  return createPortal(
    <>
      <div
        className="fixed inset-0"
        style={{ zIndex: 9998 }}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
      <div
        ref={ref}
        className="flex flex-col rounded-xl border overflow-hidden animate-in fade-in-0 zoom-in-95 duration-100"
        style={{
          position: 'fixed',
          top,
          left,
          width,
          maxHeight: maxH,
          zIndex: 9999,
          borderColor: 'var(--sh-hair)',
          background: 'var(--surface)',
          boxShadow: '0 12px 36px -4px rgba(0,0,0,0.22), 0 4px 12px -2px rgba(0,0,0,0.12)',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="p-2.5 border-b border-[var(--sh-hair)] bg-[var(--surface)] shrink-0">
          <div className="relative flex items-center">
            <svg
              className="absolute left-2.5 w-3.5 h-3.5 pointer-events-none text-[var(--sh-ink-4)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search statuses (e.g. Focus, In Progress)..."
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-[var(--surface-alt)] border border-[var(--sh-hair)] rounded-lg text-[var(--sh-ink)] placeholder-[var(--sh-ink-4)] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]/20"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  searchRef.current?.focus();
                }}
                className="absolute right-2 text-xs text-[var(--sh-ink-4)] hover:text-[var(--sh-ink-2)]"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <div className="overflow-y-auto flex-1 py-1 divide-y divide-[var(--sh-hair)]/40 scrollbar-thin">
          {grouped.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[var(--surface-alt)] text-[var(--sh-ink-4)] mb-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <p className="text-xs font-medium text-[var(--sh-ink-2)]">No statuses found</p>
              <p className="text-[11px] text-[var(--sh-ink-4)] mt-0.5">Try searching with a different term</p>
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.groupName} className="py-1">
                <div className="px-3 py-1 flex items-center justify-between text-[10px] font-semibold tracking-wider uppercase text-[var(--sh-ink-4)] bg-[var(--surface)] select-none">
                  <span className="flex items-center gap-1.5">
                    {group.emoji && <span aria-hidden>{group.emoji}</span>}
                    <span>{group.groupName}</span>
                  </span>
                  <span className="text-[9px] opacity-70 font-normal">{group.items.length}</span>
                </div>

                <div className="space-y-0.5 px-1">
                  {group.items.map((item) => {
                    const selected = isSelected(item.status);
                    const flatIdx = flatList.indexOf(item);
                    const highlighted = flatIdx === highlightedIndex;
                    return (
                      <button
                        key={item.status.id || item.status.name}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onChange(item.status.name);
                          onClose();
                        }}
                        onMouseEnter={() => setHighlightedIndex(flatIdx)}
                        className={`group w-full flex items-start gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                          selected
                            ? 'bg-[#2962FF]/10 text-[var(--sh-ink)]'
                            : highlighted
                            ? 'bg-[var(--sh-hair-3)] text-[var(--sh-ink)]'
                            : 'hover:bg-[var(--sh-hair-3)] text-[var(--sh-ink)]'
                        }`}
                      >
                        <div
                          className="mt-0.5 w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                          style={{
                            backgroundColor: `color-mix(in srgb, ${item.status.color || '#6b7280'} 16%, transparent)`,
                            color: item.status.color || 'var(--sh-ink-3)',
                          }}
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: item.status.color || 'var(--sh-ink-4)' }}
                          />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[12.5px] font-medium text-[var(--sh-ink)] leading-snug truncate">
                              {item.status.name}
                            </span>
                            {item.status.is_default && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-medium bg-[var(--surface-alt)] text-[var(--sh-ink-4)] border border-[var(--sh-hair)]">
                                Default
                              </span>
                            )}
                          </div>
                          {item.description && (
                            <p className="text-[11px] text-[var(--sh-ink-3)] leading-tight mt-0.5 line-clamp-2 opacity-85">
                              {item.description}
                            </p>
                          )}
                        </div>

                        {selected && (
                          <svg
                            className="w-4 h-4 text-[#2962FF] shrink-0 mt-0.5"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="px-3 py-1.5 bg-[var(--surface-alt)] border-t border-[var(--sh-hair)] text-[10.5px] text-[var(--sh-ink-4)] flex items-center justify-between shrink-0">
          <span>{flatList.length} status{flatList.length !== 1 ? 'es' : ''} available</span>
          <span className="text-[9.5px]">Use ↑↓ to navigate, ↵ to pick</span>
        </div>
      </div>
    </>,
    document.body,
  );
}
