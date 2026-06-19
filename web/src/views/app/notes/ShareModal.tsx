'use client';
import { useEffect, useState } from 'react';
import api from '../../../services/api';
import { useNoteShares, useSetNoteShares } from '../../../hooks/useNotes';
import type { GranteeOption, NoteAccessLevel, NoteGranteeType } from './types';

interface DraftShare {
  grantee_type: NoteGranteeType;
  grantee_id: string;
  access_level: NoteAccessLevel;
  label: string;
  avatar_url?: string | null;
}

interface UserResult {
  id: string;
  display_name: string;
  avatar_url: string | null;
}

type Tab = 'user' | 'role' | 'department';

export default function ShareModal({
  noteId,
  noteTitle,
  workspaceId,
  onClose,
}: {
  noteId: string;
  noteTitle: string;
  workspaceId: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useNoteShares(noteId);
  const setShares = useSetNoteShares(noteId, workspaceId);

  const [draft, setDraft] = useState<DraftShare[]>([]);
  const [tab, setTab] = useState<Tab>('user');
  const [query, setQuery] = useState('');
  const [userResults, setUserResults] = useState<UserResult[]>([]);
  const [options, setOptions] = useState<{ roles: GranteeOption[]; departments: GranteeOption[] }>({ roles: [], departments: [] });

  // Seed from server.
  useEffect(() => {
    if (data?.shares) {
      setDraft(data.shares.map((s) => ({ grantee_type: s.grantee_type, grantee_id: s.grantee_id, access_level: s.access_level, label: s.label, avatar_url: s.avatar_url })));
    }
  }, [data]);

  // Role/department options.
  useEffect(() => {
    api.get('/notes/grantee-options').then((r) => setOptions(r.data.data)).catch(() => {});
  }, []);

  // Debounced user search.
  useEffect(() => {
    if (tab !== 'user') return;
    const q = query.trim();
    if (!q) { setUserResults([]); return; }
    const t = setTimeout(() => {
      api.get(`/users/search?q=${encodeURIComponent(q)}&workspace_id=${workspaceId}`)
        .then((r) => setUserResults(r.data.data || []))
        .catch(() => setUserResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [query, tab, workspaceId]);

  const has = (type: NoteGranteeType, id: string) => draft.some((d) => d.grantee_type === type && d.grantee_id === id);
  const add = (s: DraftShare) => { if (!has(s.grantee_type, s.grantee_id)) setDraft((d) => [...d, s]); };
  const remove = (type: NoteGranteeType, id: string) => setDraft((d) => d.filter((x) => !(x.grantee_type === type && x.grantee_id === id)));
  const setLevel = (type: NoteGranteeType, id: string, level: NoteAccessLevel) =>
    setDraft((d) => d.map((x) => (x.grantee_type === type && x.grantee_id === id ? { ...x, access_level: level } : x)));

  const save = () => {
    setShares.mutate(
      draft.map((d) => ({ grantee_type: d.grantee_type, grantee_id: d.grantee_id, access_level: d.access_level })),
      { onSuccess: onClose },
    );
  };

  const tabOptions: GranteeOption[] = tab === 'role' ? options.roles : tab === 'department' ? options.departments : [];
  const filteredOpts = tabOptions.filter((o) => o.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/30 pt-24" onClick={onClose}>
      <div className="w-[480px] max-w-[92vw] rounded-xl border border-[var(--sh-hair)] bg-[var(--surface)] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--sh-hair)] px-4 py-3">
          <h3 className="truncate text-[14px] font-semibold text-[var(--sh-ink)]">Share “{noteTitle || 'Untitled'}”</h3>
          <button className="text-[var(--sh-ink-4)] hover:text-[var(--sh-ink)]" onClick={onClose}>✕</button>
        </div>

        <div className="p-4">
          {/* tabs */}
          <div className="mb-2 flex gap-1">
            {(['user', 'role', 'department'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setQuery(''); }}
                className={`rounded-md px-2.5 py-1 text-[12.5px] capitalize transition ${
                  tab === t ? 'bg-[var(--sh-hair-3)] text-[var(--sh-ink)]' : 'text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)]'
                }`}
              >
                {t === 'user' ? 'People' : t === 'role' ? 'Roles' : 'Teams'}
              </button>
            ))}
          </div>

          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === 'user' ? 'Search people…' : tab === 'role' ? 'Search roles…' : 'Search teams…'}
            className="w-full rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--sh-ink)] outline-none focus:border-[var(--sh-ink-4)]"
          />

          {/* results */}
          <div className="mt-1 max-h-[160px] overflow-y-auto">
            {tab === 'user' && userResults.map((u) => (
              <button
                key={u.id}
                disabled={has('user', u.id)}
                onClick={() => { add({ grantee_type: 'user', grantee_id: u.id, access_level: 'read', label: u.display_name, avatar_url: u.avatar_url }); setQuery(''); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] disabled:opacity-40"
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--sh-hair-3)] text-[11px]">{u.display_name?.[0]?.toUpperCase() || '?'}</span>
                {u.display_name}
              </button>
            ))}
            {tab !== 'user' && filteredOpts.map((o) => (
              <button
                key={o.id}
                disabled={has(tab, o.id)}
                onClick={() => { add({ grantee_type: tab, grantee_id: o.id, access_level: 'read', label: o.name }); setQuery(''); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] disabled:opacity-40"
              >
                <span className="grid h-6 w-6 place-items-center rounded-md bg-[var(--sh-hair-3)] text-[11px]">{tab === 'role' ? '🛡' : '👥'}</span>
                {o.name}
              </button>
            ))}
          </div>

          {/* current shares */}
          <div className="mt-3 border-t border-[var(--sh-hair)] pt-3">
            <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-[var(--sh-ink-4)]">Shared with</div>
            {isLoading && <p className="py-2 text-[12.5px] text-[var(--sh-ink-4)]">Loading…</p>}
            {!isLoading && draft.length === 0 && <p className="py-2 text-[12.5px] text-[var(--sh-ink-4)]">Private — only you.</p>}
            <div className="max-h-[180px] overflow-y-auto">
              {draft.map((d) => (
                <div key={`${d.grantee_type}:${d.grantee_id}`} className="flex items-center gap-2 py-1">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--sh-hair-3)] text-[11px]">
                    {d.grantee_type === 'user' ? d.label?.[0]?.toUpperCase() || '?' : d.grantee_type === 'role' ? '🛡' : '👥'}
                  </span>
                  <span className="flex-1 truncate text-[13px] text-[var(--sh-ink-2)]">{d.label}</span>
                  <select
                    value={d.access_level}
                    onChange={(e) => setLevel(d.grantee_type, d.grantee_id, e.target.value as NoteAccessLevel)}
                    className="rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-1.5 py-0.5 text-[12px] text-[var(--sh-ink-2)] outline-none"
                  >
                    <option value="read">Can view</option>
                    <option value="edit">Can edit</option>
                  </select>
                  <button className="text-[var(--sh-ink-4)] hover:text-[var(--sh-ink)]" onClick={() => remove(d.grantee_type, d.grantee_id)}>✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--sh-hair)] px-4 py-3">
          <button className="rounded-md px-3 py-1.5 text-[13px] text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)]" onClick={onClose}>Cancel</button>
          <button
            className="rounded-md bg-[var(--sh-ink)] px-3 py-1.5 text-[13px] font-medium text-[var(--surface)] disabled:opacity-50"
            onClick={save}
            disabled={setShares.isPending}
          >
            {setShares.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
