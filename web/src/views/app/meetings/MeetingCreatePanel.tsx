import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { MeetingEventDetail, MeetingKind } from '@squadhub/shared';
import { useWorkspaceMembers } from '../../../hooks/useWorkspaceMembers';
import { useAssignableUsersByList } from '../../../hooks/useAssignableUsers';
import { useMemberships } from '../../../hooks/useMemberships';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { useCreateMeetingEvent, useMeetingProviders, type CreateMeetingSlotInput } from '../../../hooks/useMeetingEvents';
import { MEETING_ACCENT, avatarColor, initialOf, timeStrToMin, DURATION_OPTIONS, durationLabel } from './meetingUtils';

interface DateRow {
  date: string;
  times: string[];
}

type Member = { id: string; display_name: string; avatar_url?: string | null };
const toMember = (u: { id: string; display_name?: string | null; email?: string | null; avatar_url?: string | null }): Member => ({
  id: u.id,
  display_name: u.display_name || u.email || 'Member',
  avatar_url: u.avatar_url ?? null,
});

const KIND_META: { key: MeetingKind; label: string; icon: ReactNode }[] = [
  {
    key: 'virtual',
    label: 'Virtual',
    icon: (
      <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    ),
  },
  {
    key: 'in_person',
    label: 'In Person',
    icon: <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z" />,
  },
  {
    key: 'event',
    label: 'Event',
    icon: <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />,
  },
];

const SECTION = 'mb-2 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--sh-ink-4)]';
const FIELD =
  'w-full rounded-lg border border-[color:var(--sh-hair)] bg-[color:var(--surface)] px-3 py-2 text-[13px] text-[color:var(--sh-ink)] outline-none focus:border-[#0a7d55] focus:ring-1 focus:ring-[#0a7d55]';

export default function MeetingCreatePanel({
  workspaceId,
  channelId,
  channelKind,
  listId,
  initialTitle,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  channelId?: string | null;
  channelKind?: 'channel' | 'dm' | null;
  listId?: string | null;
  initialTitle?: string;
  onClose: () => void;
  onCreated?: (detail: MeetingEventDetail) => void;
}) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const { data: providers = [] } = useMeetingProviders();
  const create = useCreateMeetingEvent();

  const isChannel = channelKind === 'channel';
  const isDm = channelKind === 'dm';

  // Context-scoped guest sources — only the active one fetches.
  const listUsers = useAssignableUsersByList(listId ?? null);
  const channelMembers = useMemberships('channel', isChannel ? channelId ?? null : null);
  const wsMembers = useWorkspaceMembers(workspaceId);
  const dmConvs = useWorkspaceStore((s) => s.dmConversations);

  const [mounted, setMounted] = useState(false);
  const [kind, setKind] = useState<MeetingKind>('virtual');
  const [title, setTitle] = useState(initialTitle || '');
  const [agenda, setAgenda] = useState('');
  const [provider, setProvider] = useState('');
  const [guestIds, setGuestIds] = useState<string[]>([]);
  const [includeAll, setIncludeAll] = useState<boolean>(channelKind === 'channel');
  const [guestSearch, setGuestSearch] = useState('');
  const [guestMenuOpen, setGuestMenuOpen] = useState(false);
  const [dmTab, setDmTab] = useState<'chat' | 'external'>('chat');
  const [datesOnly, setDatesOnly] = useState(false);
  const [duration, setDuration] = useState(30);
  const [dateRows, setDateRows] = useState<DateRow[]>([{ date: '', times: ['17:00'] }]);
  const [postCard, setPostCard] = useState<boolean>(!!channelId);
  const guestBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (guestBoxRef.current && !guestBoxRef.current.contains(e.target as Node)) setGuestMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const close = () => {
    setMounted(false);
    setTimeout(onClose, 240);
  };

  const selectedProvider = provider || providers[0]?.id || 'jitsi';

  const wsList = useMemo<Member[]>(() => (wsMembers.data || []).map(toMember), [wsMembers.data]);
  const dmParticipants = useMemo<Member[]>(() => {
    if (!isDm || !channelId) return [];
    const conv = dmConvs.find((c) => c.id === channelId);
    return (conv?.participants || []).map(toMember);
  }, [isDm, channelId, dmConvs]);

  // The people offered in the dropdown, scoped to the creation context:
  //  • list    → only people with access to that list
  //  • channel → only that channel's members
  //  • DM      → "In this chat" (the two participants) or "External" (people you
  //              have access to) via the tab toggle
  //  • else    → everyone in your workspace
  const candidates = useMemo<Member[]>(() => {
    if (listId) return (listUsers.data || []).map(toMember);
    if (isChannel) return (channelMembers.data || []).filter((m) => m.user).map((m) => toMember(m.user!));
    if (isDm) return dmTab === 'chat' ? dmParticipants : wsList;
    return wsList;
  }, [listId, isChannel, isDm, dmTab, listUsers.data, channelMembers.data, dmParticipants, wsList]);

  // Union of everything loaded so a selected chip always resolves a name.
  const known = useMemo(() => {
    const m = new Map<string, Member>();
    for (const u of listUsers.data || []) m.set(u.id, toMember(u));
    for (const cm of channelMembers.data || []) if (cm.user) m.set(cm.user.id, toMember(cm.user));
    for (const u of wsList) m.set(u.id, u);
    for (const u of dmParticipants) m.set(u.id, u);
    return m;
  }, [listUsers.data, channelMembers.data, wsList, dmParticipants]);

  const filteredMembers = useMemo(() => {
    const q = guestSearch.trim().toLowerCase();
    return candidates
      .filter((m) => !guestIds.includes(m.id))
      .filter((m) => !q || m.display_name.toLowerCase().includes(q))
      .slice(0, 30);
  }, [candidates, guestSearch, guestIds]);

  const addGuest = (id: string) => {
    setGuestIds((p) => [...p, id]);
    setGuestSearch('');
  };
  const removeGuest = (id: string) => setGuestIds((p) => p.filter((x) => x !== id));

  const setRow = (i: number, patch: Partial<DateRow>) =>
    setDateRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addDate = () => setDateRows((rows) => [...rows, { date: '', times: datesOnly ? [] : ['17:00'] }]);
  const removeDate = (i: number) => setDateRows((rows) => rows.filter((_, idx) => idx !== i));
  const addTime = (i: number) => setRow(i, { times: [...dateRows[i].times, '17:00'] });
  const setTime = (i: number, ti: number, v: string) =>
    setRow(i, { times: dateRows[i].times.map((t, idx) => (idx === ti ? v : t)) });
  const removeTime = (i: number, ti: number) => setRow(i, { times: dateRows[i].times.filter((_, idx) => idx !== ti) });

  const canSubmit = title.trim().length > 0 && dateRows.some((r) => r.date);

  const submit = () => {
    if (!canSubmit) return;
    const slots: CreateMeetingSlotInput[] = [];
    for (const row of dateRows) {
      if (!row.date) continue;
      if (datesOnly || row.times.length === 0) slots.push({ slot_date: row.date, start_min: null });
      else for (const t of row.times) slots.push({ slot_date: row.date, start_min: timeStrToMin(t) });
    }
    if (!slots.length) return;
    create.mutate(
      {
        title: title.trim(),
        kind,
        agenda: agenda.trim() || undefined,
        duration_min: datesOnly ? null : duration,
        timezone: tz,
        guest_ids: guestIds,
        include_all_channel: includeAll && channelKind === 'channel' ? true : undefined,
        origin_channel_id: channelKind === 'channel' ? channelId ?? null : null,
        origin_dm_conversation_id: channelKind === 'dm' ? channelId ?? null : null,
        link_provider: kind === 'virtual' ? (selectedProvider as any) : undefined,
        slots,
        post_card: postCard && !!channelId ? true : undefined,
      },
      {
        onSuccess: (detail) => {
          onCreated?.(detail);
          close();
        },
      },
    );
  };

  const errorMessage = create.error
    ? (create.error as any)?.response?.data?.error || (create.error as any).message
    : null;

  const panel = (
    <div className="fixed inset-0 z-[95]">
      <div
        className="absolute inset-0 transition-opacity duration-200"
        style={{ opacity: mounted ? 1 : 0, background: 'rgba(10,10,10,0.18)' }}
        onClick={close}
      />
      <aside
        className="absolute right-0 top-0 bottom-0 flex w-full max-w-[480px] flex-col"
        style={{
          background: 'var(--surface)',
          boxShadow: '-16px 24px 56px -20px rgba(0,0,0,0.18)',
          transform: mounted ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
          transition: 'transform .4s cubic-bezier(0.23,1,0.32,1), opacity .3s ease',
          opacity: mounted ? 1 : 0,
        }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[color:var(--sh-hair)] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg text-white" style={{ backgroundColor: MEETING_ACCENT }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </span>
            <div>
              <div className="text-[14px] font-semibold text-[color:var(--sh-ink)]">New Meeting</div>
              <div className="text-[11px] text-[color:var(--sh-ink-4)]">Propose times & collect availability</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={close} className="rounded-md px-2 py-1 text-[13px] text-[color:var(--sh-ink-3)] hover:bg-[color:var(--sh-hair-3)]">Cancel</button>
            <button
              onClick={submit}
              disabled={!canSubmit || create.isPending}
              className="rounded-md px-3.5 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: MEETING_ACCENT }}
            >
              {create.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Type */}
          <div className="mb-4 grid grid-cols-3 gap-2">
            {KIND_META.map((k) => (
              <button
                key={k.key}
                onClick={() => setKind(k.key)}
                className={`flex flex-col items-center gap-1 rounded-lg border py-2.5 text-[12px] font-medium transition ${
                  kind === k.key ? 'border-transparent text-white' : 'border-[color:var(--sh-hair)] text-[color:var(--sh-ink)] hover:border-[color:var(--sh-ink-4)]'
                }`}
                style={kind === k.key ? { backgroundColor: MEETING_ACCENT } : undefined}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                  {k.icon}
                </svg>
                {k.label}
              </button>
            ))}
          </div>

          {/* Name */}
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Meeting name"
            className="mb-4 w-full border-0 border-b border-[color:var(--sh-hair)] bg-transparent pb-2 text-[18px] font-semibold text-[color:var(--sh-ink)] outline-none placeholder:text-[color:var(--sh-ink-4)] focus:border-[#0a7d55]"
          />

          {/* Guests */}
          <div className="mb-4">
            <label className={SECTION}>Guests</label>
            {isChannel && (
              <label className="mb-2 flex items-center gap-2 text-[12px] text-[color:var(--sh-ink-3)]">
                <input type="checkbox" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} />
                <span>@all — everyone in this channel</span>
              </label>
            )}
            {isDm && (
              <div className="mb-2 inline-flex rounded-lg bg-[color:var(--sh-hair-3)] p-0.5 text-[12px]">
                {(['chat', 'external'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => { setDmTab(t); setGuestMenuOpen(true); }}
                    className={`rounded-md px-3 py-1 font-medium ${dmTab === t ? 'bg-[color:var(--surface)] text-[color:var(--sh-ink)] shadow-sm' : 'text-[color:var(--sh-ink-3)]'}`}
                  >
                    {t === 'chat' ? 'In this chat' : 'External'}
                  </button>
                ))}
              </div>
            )}
            {guestIds.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {guestIds.map((id) => {
                  const m = known.get(id);
                  return (
                    <span key={id} className="flex items-center gap-1.5 rounded-full bg-[color:var(--sh-hair-3)] py-0.5 pl-1 pr-2 text-[12px] text-[color:var(--sh-ink)]">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white" style={{ backgroundColor: avatarColor(id) }}>
                        {initialOf(m?.display_name)}
                      </span>
                      {m?.display_name || 'Member'}
                      <button onClick={() => removeGuest(id)} className="text-[color:var(--sh-ink-4)] hover:text-red-500">✕</button>
                    </span>
                  );
                })}
              </div>
            )}
            <div ref={guestBoxRef} className="relative">
              <input
                value={guestSearch}
                onChange={(e) => { setGuestSearch(e.target.value); setGuestMenuOpen(true); }}
                onFocus={() => setGuestMenuOpen(true)}
                placeholder="Add people…"
                className={FIELD}
              />
              {guestMenuOpen && filteredMembers.length > 0 && (
                <div className="absolute z-10 mt-1 max-h-44 w-full overflow-y-auto rounded-lg border border-[color:var(--sh-hair)] bg-[color:var(--surface)] shadow-lg">
                  {filteredMembers.map((m) => (
                    <button key={m.id} onClick={() => addGuest(m.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-[color:var(--sh-hair-3)]">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ backgroundColor: avatarColor(m.id) }}>
                        {initialOf(m.display_name)}
                      </span>
                      <span className="flex-1 text-[color:var(--sh-ink)]">{m.display_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Provider */}
          {kind === 'virtual' && (
            <div className="mb-4">
              <label className={SECTION}>Meeting App · link auto-generated</label>
              <select value={selectedProvider} onChange={(e) => setProvider(e.target.value)} className={FIELD}>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Agenda */}
          <div className="mb-4">
            <label className={SECTION}>Agenda</label>
            <textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={3} placeholder="What's this meeting about?" className={`${FIELD} resize-none`} />
          </div>

          {/* Date & time */}
          <div className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <label className={`${SECTION} mb-0`}>Date & Time</label>
              <label className="flex items-center gap-1.5 text-[11px] text-[color:var(--sh-ink-3)]">
                <input type="checkbox" checked={datesOnly} onChange={(e) => setDatesOnly(e.target.checked)} /> Dates only
              </label>
            </div>
            <div className="space-y-2">
              {dateRows.map((row, i) => (
                <div key={i} className="rounded-lg border border-[color:var(--sh-hair)] p-2.5">
                  <div className="flex items-center gap-2">
                    <input type="date" value={row.date} onChange={(e) => setRow(i, { date: e.target.value })} className={FIELD} />
                    {dateRows.length > 1 && (
                      <button onClick={() => removeDate(i)} className="text-[color:var(--sh-ink-4)] hover:text-red-500">✕</button>
                    )}
                  </div>
                  {!datesOnly && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {row.times.map((t, ti) => (
                        <span key={ti} className="flex items-center gap-1 rounded-md border border-[color:var(--sh-hair)] bg-[color:var(--sh-hair-3)] px-1.5 py-1">
                          <input type="time" value={t} onChange={(e) => setTime(i, ti, e.target.value)} className="bg-transparent text-[12px] text-[color:var(--sh-ink)] outline-none" />
                          {row.times.length > 1 && (
                            <button onClick={() => removeTime(i, ti)} className="text-[color:var(--sh-ink-4)] hover:text-red-500">✕</button>
                          )}
                        </span>
                      ))}
                      <button onClick={() => addTime(i)} className="rounded-md border border-dashed border-[color:var(--sh-hair)] px-2 py-1 text-[11px] text-[color:var(--sh-ink-3)] hover:border-[#0a7d55]">
                        + Time slot
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <button onClick={addDate} className="text-[12px] font-medium" style={{ color: MEETING_ACCENT }}>+ Add another date</button>
              {!datesOnly && (
                <label className="flex items-center gap-1.5 text-[12px] text-[color:var(--sh-ink-3)]">
                  Duration
                  <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="rounded-md border border-[color:var(--sh-hair)] bg-[color:var(--surface)] px-2 py-1 text-[12px] text-[color:var(--sh-ink)]">
                    {DURATION_OPTIONS.map((d) => (
                      <option key={d} value={d}>{durationLabel(d)}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>

          {channelId && (
            <label className="mb-2 flex items-center gap-2 text-[12px] text-[color:var(--sh-ink-3)]">
              <input type="checkbox" checked={postCard} onChange={(e) => setPostCard(e.target.checked)} />
              Post an interactive card in this conversation
            </label>
          )}

          {errorMessage && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600">{String(errorMessage)}</p>}
        </div>
      </aside>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(panel, document.body);
}
