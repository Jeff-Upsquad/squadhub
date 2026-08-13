'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Message,
  SupportAgent,
  SupportTicket,
  SupportTicketCategory,
} from '@squadhub/shared';
import { SUPPORT_TICKET_CATEGORIES } from '@squadhub/shared';
import api from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { showToast } from '@/components/Toast';

// ---- small presentational helpers (self-contained; module runs in web too) --
const CAT_CHIP: Record<SupportTicketCategory, string> = {
  technical: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  accounts: 'bg-sky-50 text-sky-700 border-sky-100',
  financial: 'bg-amber-50 text-amber-700 border-amber-100',
  general: 'bg-slate-100 text-slate-600 border-slate-200',
};
const CAT_LABEL: Record<SupportTicketCategory, string> = {
  technical: 'Technical',
  accounts: 'Accounts',
  financial: 'Financial',
  general: 'General',
};
const PRIORITY_DOT: Record<string, string> = {
  low: 'bg-slate-400',
  normal: 'bg-emerald-500',
  high: 'bg-amber-500',
  urgent: 'bg-red-500',
};

function hashGradient(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 40) % 360} 65% 45%))`;
}
function rel(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function Avatar({ id, name, url, size = 24 }: { id: string; name?: string | null; url?: string | null; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: url ? undefined : hashGradient(id) }}
    >
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : (name?.[0] || '?').toUpperCase()}
    </span>
  );
}

type Filter = 'all' | 'unassigned' | 'mine' | 'open' | 'closed';

// ---- data hooks ----
function useTickets(filter: Filter, category: SupportTicketCategory | 'all') {
  const params = new URLSearchParams();
  if (filter === 'unassigned') params.set('assignee', 'unassigned');
  else if (filter === 'mine') params.set('assignee', 'me');
  else if (filter === 'open') params.set('status', 'open');
  else if (filter === 'closed') params.set('status', 'closed');
  if (category !== 'all') params.set('category', category);
  const qs = params.toString();
  return useQuery({
    queryKey: ['support', 'manage', 'tickets', filter, category],
    queryFn: () => api.get(`/support/tickets${qs ? `?${qs}` : ''}`).then((r) => r.data.data as SupportTicket[]),
    refetchInterval: 8000,
  });
}

export default function AdminSupport() {
  const qc = useQueryClient();
  const meId = useAuthStore((s) => s.user?.id);
  const [filter, setFilter] = useState<Filter>('all');
  const [category, setCategory] = useState<SupportTicketCategory | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);

  const { data: tickets = [], isLoading } = useTickets(filter, category);
  const { data: agents = [] } = useQuery({
    queryKey: ['support', 'manage', 'agents'],
    queryFn: () => api.get('/support/agents').then((r) => r.data.data as SupportAgent[]),
  });

  const selected = tickets.find((t) => t.id === selectedId) || null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['support', 'manage'] });
  };

  const claim = useMutation({
    mutationFn: (id: string) => api.post(`/support/tickets/${id}/claim`).then((r) => r.data.data),
    onSuccess: () => { invalidate(); showToast('Ticket claimed', 'success'); },
  });
  const assign = useMutation({
    mutationFn: ({ id, assignee_id }: { id: string; assignee_id: string | null }) =>
      api.post(`/support/tickets/${id}/assign`, { assignee_id }).then((r) => r.data.data),
    onSuccess: () => { invalidate(); showToast('Assignment updated', 'success'); },
  });
  const setStatus = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'close' | 'reopen' }) =>
      api.post(`/support/tickets/${id}/${action}`).then((r) => r.data.data),
    onSuccess: () => { invalidate(); },
  });

  const counts = useMemo(() => {
    const open = tickets.filter((t) => t.status === 'open').length;
    const unassigned = tickets.filter((t) => t.status === 'open' && !t.assigned_to).length;
    return { open, unassigned };
  }, [tickets]);

  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'unassigned', label: 'Unassigned' },
    { id: 'mine', label: 'Assigned to me' },
    { id: 'open', label: 'Open' },
    { id: 'closed', label: 'Closed' },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-divider px-5 py-4">
        <div>
          <h1 className="text-[18px] font-semibold text-foreground">Support Tickets</h1>
          <p className="text-[12px] text-foreground-dim">
            {counts.open} open · {counts.unassigned} awaiting an owner
          </p>
        </div>
        <button
          onClick={() => setShowRules(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-divider px-3 py-2 text-[13px] font-medium text-foreground transition hover:bg-surface-alt"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Auto-assign rules
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 border-b border-divider px-5 py-2.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-3 py-1 text-[12.5px] font-medium transition ${
              filter === f.id ? 'bg-foreground text-surface' : 'text-foreground-muted hover:bg-surface-alt'
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-divider" />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as SupportTicketCategory | 'all')}
          className="rounded-lg border border-divider bg-surface px-2 py-1 text-[12.5px] text-foreground"
        >
          <option value="all">All categories</option>
          {SUPPORT_TICKET_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      {/* Two-pane body */}
      <div className="flex min-h-0 flex-1">
        {/* Queue */}
        <div className="w-[380px] shrink-0 overflow-y-auto border-r border-divider">
          {isLoading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-alt" />)}
            </div>
          ) : tickets.length === 0 ? (
            <p className="p-6 text-center text-[13px] text-foreground-dim">No tickets match this filter.</p>
          ) : (
            <ul>
              {tickets.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setSelectedId(t.id)}
                    className={`w-full border-b border-divider px-4 py-3 text-left transition hover:bg-surface-alt ${
                      selectedId === t.id ? 'bg-surface-alt' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-semibold text-foreground-dim">SUP-{t.ticket_number}</span>
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${CAT_CHIP[t.category]}`}>
                        {CAT_LABEL[t.category]}
                      </span>
                      <span className={`h-2 w-2 rounded-full ${PRIORITY_DOT[t.priority] || 'bg-slate-400'}`} title={t.priority} />
                      {t.status === 'closed' && (
                        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase text-slate-500">Closed</span>
                      )}
                    </div>
                    <div className="mt-1 truncate text-[13.5px] font-semibold text-foreground">{t.subject}</div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-foreground-dim">
                      <span className="truncate">{t.creator?.display_name || t.creator?.email || 'user'} · {rel(t.last_activity_at)}</span>
                      {t.assignee ? (
                        <Avatar id={t.assignee.id} name={t.assignee.display_name} url={t.assignee.avatar_url} size={18} />
                      ) : (
                        <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase text-amber-700">
                          Unassigned
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Detail */}
        <div className="min-w-0 flex-1">
          {selected ? (
            <TicketDetail
              ticket={selected}
              agents={agents}
              meId={meId}
              onClaim={() => claim.mutate(selected.id)}
              onAssign={(assignee_id) => assign.mutate({ id: selected.id, assignee_id })}
              onToggleStatus={() =>
                setStatus.mutate({ id: selected.id, action: selected.status === 'open' ? 'close' : 'reopen' })
              }
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center text-foreground-dim">
              <svg className="mb-3 h-10 w-10 opacity-30" fill="none" stroke="currentColor" strokeWidth={1.4} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-6 0a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <p className="text-[13px]">Select a ticket to view the conversation.</p>
            </div>
          )}
        </div>
      </div>

      {showRules && <RoutingRulesModal agents={agents} onClose={() => setShowRules(false)} />}
    </div>
  );
}

// ---- Ticket detail + conversation ----
function TicketDetail({
  ticket,
  agents,
  meId,
  onClaim,
  onAssign,
  onToggleStatus,
}: {
  ticket: SupportTicket;
  agents: SupportAgent[];
  meId?: string;
  onClaim: () => void;
  onAssign: (assigneeId: string | null) => void;
  onToggleStatus: () => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const { data: messages = [] } = useQuery({
    queryKey: ['support', 'manage', 'messages', ticket.id],
    queryFn: () => api.get(`/support/tickets/${ticket.id}/messages`).then((r) => r.data.data as Message[]),
    refetchInterval: 6000,
  });
  const send = useMutation({
    mutationFn: (content: string) =>
      api.post(`/support/tickets/${ticket.id}/messages`, { content }).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['support', 'manage', 'messages', ticket.id] });
      qc.invalidateQueries({ queryKey: ['support', 'manage', 'tickets'] });
    },
  });
  const closed = ticket.status === 'closed';

  const submit = async () => {
    const c = draft.trim();
    if (!c || send.isPending) return;
    setDraft('');
    await send.mutateAsync(c);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Ticket header */}
      <div className="border-b border-divider px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold text-foreground-dim">SUP-{ticket.ticket_number}</span>
          <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${CAT_CHIP[ticket.category]}`}>
            {CAT_LABEL[ticket.category]}
          </span>
          <span className="text-[11px] capitalize text-foreground-dim">{ticket.priority} priority</span>
        </div>
        <h2 className="mt-1.5 text-[16px] font-semibold text-foreground">{ticket.subject}</h2>
        <div className="mt-1 text-[11.5px] text-foreground-dim">
          Opened by {ticket.creator?.display_name || ticket.creator?.email || 'a user'} · {rel(ticket.created_at)}
        </div>

        {/* Triage controls */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={ticket.assigned_to || ''}
            onChange={(e) => onAssign(e.target.value || null)}
            className="rounded-lg border border-divider bg-surface px-2.5 py-1.5 text-[12.5px] text-foreground"
          >
            <option value="">Unassigned</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.display_name || a.email}</option>
            ))}
          </select>
          {!ticket.assigned_to && meId && (
            <button
              onClick={onClaim}
              className="rounded-lg border border-divider px-3 py-1.5 text-[12.5px] font-semibold text-foreground transition hover:bg-surface-alt"
            >
              Claim
            </button>
          )}
          <button
            onClick={onToggleStatus}
            className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition ${
              closed
                ? 'border border-divider text-foreground hover:bg-surface-alt'
                : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            {closed ? 'Reopen' : 'Mark resolved'}
          </button>
        </div>
      </div>

      {/* Conversation */}
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {messages.map((m: any, i: number) => (
          <div key={m.id} className="flex gap-3">
            <Avatar id={m.sender?.id || m.sender_id} name={m.sender?.display_name} url={m.sender?.avatar_url} size={30} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-semibold text-foreground">
                  {m.sender?.display_name || m.sender?.email || 'User'}
                  {m.sender?.id === meId && <span className="ml-1 text-[11px] font-normal text-foreground-dim">(you)</span>}
                </span>
                <span className="text-[11px] text-foreground-dim">
                  {new Date(m.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
                {i === 0 && (
                  <span className="rounded bg-surface-alt px-1.5 py-0.5 text-[10px] font-medium text-foreground-dim">Original request</span>
                )}
              </div>
              <div className="mt-0.5 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-foreground">{m.content}</div>
              {m.file_url && (
                <a href={m.file_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[12px] text-blue-600 underline">
                  {m.file_name || 'Attachment'}
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Reply */}
      {closed ? (
        <div className="border-t border-divider px-5 py-3 text-center text-[12px] text-foreground-dim">
          This ticket is closed. Reopen it to reply.
        </div>
      ) : (
        <div className="border-t border-divider px-5 py-3">
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder="Reply to the customer…"
              className="max-h-40 min-h-[40px] flex-1 resize-none rounded-lg border border-divider bg-surface px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground"
            />
            <button
              onClick={submit}
              disabled={!draft.trim() || send.isPending}
              className="h-[40px] rounded-lg bg-foreground px-4 text-[13px] font-semibold text-surface transition disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Auto-assign routing rules ----
function RoutingRulesModal({ agents, onClose }: { agents: SupportAgent[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: rules } = useQuery({
    queryKey: ['support', 'manage', 'routing'],
    queryFn: () =>
      api.get('/support/routing').then(
        (r) => r.data.data as { category: SupportTicketCategory; assignee_id: string | null }[],
      ),
  });
  const [local, setLocal] = useState<Record<string, string>>({});
  const value = (cat: SupportTicketCategory) =>
    local[cat] ?? (rules?.find((r) => r.category === cat)?.assignee_id ?? '');

  const save = useMutation({
    mutationFn: () =>
      api.put('/support/routing', {
        rules: SUPPORT_TICKET_CATEGORIES.map((c) => ({
          category: c.value,
          assignee_id: value(c.value) || null,
        })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['support', 'manage', 'routing'] });
      showToast('Auto-assign rules saved', 'success');
      onClose();
    },
  });

  return (
    <>
      <div className="fixed inset-0 z-[95] bg-black/30" onClick={onClose} />
      <div className="fixed inset-0 z-[96] flex items-start justify-center overflow-y-auto p-6">
        <div className="w-full max-w-md rounded-2xl border border-divider bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <header className="border-b border-divider px-5 py-4">
            <h2 className="text-[15px] font-semibold text-foreground">Auto-assign rules</h2>
            <p className="mt-0.5 text-[12px] text-foreground-dim">
              New tickets in a category are automatically assigned to the chosen agent.
            </p>
          </header>
          <div className="space-y-3 px-5 py-4">
            {SUPPORT_TICKET_CATEGORIES.map((c) => (
              <div key={c.value} className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-medium text-foreground">{c.label}</span>
                <select
                  value={value(c.value)}
                  onChange={(e) => setLocal((p) => ({ ...p, [c.value]: e.target.value }))}
                  className="w-56 rounded-lg border border-divider bg-surface px-2.5 py-1.5 text-[12.5px] text-foreground"
                >
                  <option value="">No auto-assign</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.display_name || a.email}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <footer className="flex justify-end gap-2 border-t border-divider px-5 py-3.5">
            <button onClick={onClose} className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-foreground-muted hover:bg-surface-alt">
              Cancel
            </button>
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="rounded-lg bg-foreground px-4 py-2 text-[13px] font-semibold text-surface disabled:opacity-40"
            >
              {save.isPending ? 'Saving…' : 'Save rules'}
            </button>
          </footer>
        </div>
      </div>
    </>
  );
}
