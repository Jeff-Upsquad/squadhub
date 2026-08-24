import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AxiosError } from 'axios';
import { useAuthStore } from '../../../stores/authStore';
import { useCreateDm, useDmContacts, type DmContact } from '../../../hooks/useDms';
import { useWorkspaceStore } from '../../../stores/workspaceStore';

type UserPick = DmContact;

interface Props {
  workspaceId: string;
  onClose: () => void;
}

// Slack-style "New DM" modal. Multi-select up to 7 other users (8 total incl. self).
export default function NewDmModal({ workspaceId, onClose }: Props) {
  const me = useAuthStore((s) => s.user);
  const setActiveChannel = useWorkspaceStore((s) => s.setActiveChannel);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<UserPick[]>([]);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const create = useCreateDm(workspaceId);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const { data: results = [], isFetching } = useDmContacts(workspaceId, query);

  const filtered = results.filter(
    (u) => u.id !== me?.id && !picked.some((p) => p.id === u.id),
  );

  const togglePick = (u: UserPick) => {
    setPicked((cur) => (cur.some((c) => c.id === u.id) ? cur.filter((c) => c.id !== u.id) : [...cur, u]));
    setQuery('');
    inputRef.current?.focus();
  };

  const removePick = (id: string) => setPicked((cur) => cur.filter((c) => c.id !== id));

  const handleStart = async () => {
    if (picked.length === 0 || creating) return;
    setCreating(true);
    try {
      const conv = await create.mutateAsync(picked.map((p) => p.id));
      if (conv?.id) {
        setActiveChannel(conv.id, 'dm');
      }
      onClose();
    } catch (err) {
      console.error('Create DM failed:', err);
      const msg =
        err instanceof AxiosError && typeof err.response?.data?.error === 'string'
          ? err.response.data.error
          : 'Could not start this chat. You can only message people you share a space or channel with.';
      alert(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleBackspace = (e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && query === '' && picked.length > 0) {
      setPicked((cur) => cur.slice(0, -1));
    } else if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault();
      togglePick(filtered[0]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 px-4 py-10"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[520px] rounded-[8px] border border-divider bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-divider px-5 py-4">
          <h2 className="text-[18px] font-bold text-foreground">New direct message</h2>
          <button onClick={onClose} className="text-foreground-muted hover:text-foreground" aria-label="Close">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Recipient picker */}
        <div className="px-5 py-3">
          <label className="text-[12px] font-semibold uppercase tracking-wide text-foreground-muted">To</label>
          <div className="mt-1 flex flex-wrap items-center gap-[6px] rounded-[6px] border border-divider bg-background px-2 py-[6px] focus-within:border-[#1264A3]">
            {picked.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1 rounded-[4px] bg-[rgba(18,100,163,0.12)] px-2 py-[3px] text-[13px] text-[#1264A3]"
              >
                {p.display_name}
                <button
                  type="button"
                  onClick={() => removePick(p.id)}
                  className="text-[#1264A3] hover:text-[#0b4575]"
                  aria-label={`Remove ${p.display_name}`}
                >
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleBackspace}
              placeholder={picked.length === 0 ? 'Search people you share work with…' : ''}
              className="flex-1 min-w-[80px] bg-transparent text-[14px] text-foreground outline-none"
              disabled={picked.length >= 7}
            />
          </div>
          {picked.length >= 7 && (
            <p className="mt-1 text-[11px] text-foreground-muted">Group DMs allow up to 8 people including you.</p>
          )}
        </div>

        {/* Results */}
        <div className="max-h-[280px] min-h-[80px] overflow-y-auto border-t border-divider">
          {query && filtered.length === 0 && !isFetching && (
            <p className="px-5 py-6 text-center text-[13px] text-foreground-muted">
              No one you can message matches &ldquo;{query}&rdquo;
            </p>
          )}
          {filtered.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => togglePick(u)}
              className="flex w-full items-center gap-3 px-5 py-2 text-left transition hover:bg-surface-alt"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-[4px] bg-[#E2E8F0] text-[12px] font-bold text-[#0F172B] overflow-hidden">
                {u.avatar_url ? (
                  <img src={u.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  u.display_name?.[0]?.toUpperCase() || '?'
                )}
              </span>
              <span className="flex flex-col">
                <span className="text-[14px] font-medium text-foreground">{u.display_name}</span>
                {u.role?.name && (
                  <span className="flex items-center gap-1.5 text-[11px] text-foreground-muted">
                    <span
                      className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
                      style={{ backgroundColor: u.role.color || 'var(--sh-ink-4)' }}
                    />
                    {u.role.name}
                  </span>
                )}
              </span>
            </button>
          ))}
          {!query && picked.length === 0 && filtered.length === 0 && !isFetching && (
            <p className="px-5 py-6 text-center text-[13px] text-foreground-muted">
              No one you can message yet. You can only DM people you share a space or channel with.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-divider px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[4px] border border-divider px-3 py-[6px] text-[13px] font-medium text-foreground hover:bg-surface-alt"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleStart}
            disabled={picked.length === 0 || creating}
            className="rounded-[4px] bg-[#007A5A] px-4 py-[6px] text-[13px] font-medium text-white transition hover:bg-[#148567] disabled:opacity-50"
          >
            {creating ? 'Starting…' : `Start chat${picked.length > 1 ? ` (${picked.length + 1})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
