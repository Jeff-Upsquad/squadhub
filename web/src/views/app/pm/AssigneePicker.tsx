import { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@squadhub/shared';
import { useAssignableUsers } from '../../../hooks/useAssignableUsers';

function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function avatarColor(seed: string | undefined | null): string {
  if (!seed) return 'oklch(0.6 0.1 260)';
  return `oklch(0.6 0.12 ${hashHue(seed)})`;
}

function initialOf(name: string | undefined | null): string {
  if (!name) return '?';
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || '';
  const second = parts[1]?.[0] || '';
  return (first + second).toUpperCase() || '?';
}

export default function AssigneePicker({
  taskId,
  currentAssigneeIds,
  anchorRect,
  onChange,
  onClose,
}: {
  taskId: string;
  currentAssigneeIds: string[];
  anchorRect: DOMRect | null;
  onChange: (ids: string[]) => void;
  onClose: () => void;
}) {
  const { data: users = [], isLoading } = useAssignableUsers(taskId);
  const [query, setQuery] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onClickOutside(e: MouseEvent) {
      if (!panelRef.current) return;
      if (panelRef.current.contains(e.target as Node)) return;
      onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      (u.display_name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q),
    );
  }, [users, query]);

  const selectedSet = useMemo(() => new Set(currentAssigneeIds), [currentAssigneeIds]);

  const toggle = (u: User) => {
    const next = selectedSet.has(u.id)
      ? currentAssigneeIds.filter(id => id !== u.id)
      : [...currentAssigneeIds, u.id];
    onChange(next);
  };

  // Position the popover below the anchor (or above if not enough space).
  const style = useMemo<React.CSSProperties>(() => {
    if (!anchorRect) {
      return { top: 0, left: 0 };
    }
    const width = 300;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const spaceBelow = vh - anchorRect.bottom;
    const spaceAbove = anchorRect.top;
    const height = 360;
    const placeAbove = spaceBelow < height && spaceAbove > spaceBelow;
    let left = anchorRect.left;
    if (left + width > vw - 8) left = vw - width - 8;
    if (left < 8) left = 8;
    const top = placeAbove ? Math.max(8, anchorRect.top - height - 4) : anchorRect.bottom + 4;
    return { top, left, width };
  }, [anchorRect]);

  return (
    <div
      ref={panelRef}
      className="ap-panel"
      style={style}
      role="dialog"
      aria-label="Assign people to task"
    >
      <div className="ap-search">
        <input
          ref={inputRef}
          type="text"
          placeholder="Search people…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="ap-input"
        />
      </div>

      <div className="ap-list">
        {isLoading && (
          <div className="ap-empty">Loading…</div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="ap-empty">{users.length === 0 ? 'No one to assign' : 'No matches'}</div>
        )}
        {!isLoading && filtered.map((u) => {
          const selected = selectedSet.has(u.id);
          return (
            <button
              type="button"
              key={u.id}
              className="ap-row"
              data-selected={selected}
              onClick={() => toggle(u)}
            >
              <span
                className="ap-ava"
                style={{ background: avatarColor(u.id || u.email) }}
                aria-hidden
              >
                {initialOf(u.display_name || u.email)}
              </span>
              <span className="ap-label">
                <span className="ap-name">{u.display_name || u.email}</span>
                {u.display_name && u.email && (
                  <span className="ap-email">{u.email}</span>
                )}
              </span>
              {selected && (
                <svg className="ap-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          );
        })}
      </div>

      {currentAssigneeIds.length > 0 && (
        <button
          type="button"
          className="ap-clear"
          onClick={() => onChange([])}
        >
          Unassign all
        </button>
      )}
    </div>
  );
}
