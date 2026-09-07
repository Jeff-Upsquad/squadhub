'use client';
import { useEffect, useState } from 'react';
import { useAllSopRules, useReportBreach } from '../../hooks/useSopBreaches';
import api from '../../services/api';

interface Props {
  targetUserId: string;
  targetUserName?: string;
  sourceKind?: 'task' | 'message' | 'manual';
  sourceId?: string;
  // Scoping for the reportee picker — only members of this chat / list are shown.
  channelId?: string | null;
  dmConversationId?: string | null;
  listId?: string | null;
  taskId?: string | null;
  onClose: () => void;
  onReported?: (info: { sop_label: string; count_in_window: number; threshold: number; window_label: string; severity: string; strike_points: number; is_strike: boolean; sop_link: string }) => void;
}

export default function SopBreachReportModal({ targetUserId, targetUserName, sourceKind = 'manual', sourceId, channelId, dmConversationId, listId, taskId, onClose, onReported }: Props) {
  const { data: rules, isLoading } = useAllSopRules();
  const report = useReportBreach();
  const [selectedRuleId, setSelectedRuleId] = useState<string>('');
  const [reason, setReason] = useState('');

  // Reportee (the person the breach is filed against). Defaults to the
  // message/task person, but can be changed via search below.
  const [reporteeId, setReporteeId] = useState<string>(targetUserId);
  const [reporteeName, setReporteeName] = useState<string>(targetUserName || targetUserId);
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState<Array<{ id: string; display_name: string; avatar_url?: string | null; email?: string | null }>>([]);
  const [userSearching, setUserSearching] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  // List/task scope: members allowed as reportee (client-filtered by query).
  const [scopedMembers, setScopedMembers] = useState<Array<{ id: string; display_name: string; avatar_url?: string | null; email?: string | null }> | null>(null);

  useEffect(() => {
    setReporteeId(targetUserId);
    setReporteeName(targetUserName || targetUserId);
  }, [targetUserId, targetUserName]);

  const hasChatScope = !!(channelId || dmConversationId);
  const scopeTaskId = taskId || (sourceKind === 'task' ? sourceId : undefined);
  const scopeListId = listId || undefined;

  // Load list/task members once when the picker opens (task scope).
  useEffect(() => {
    if (!userOpen || hasChatScope) return;
    const idForTask = scopeTaskId;
    const idForList = scopeListId;
    if (!idForTask && !idForList) { setScopedMembers(null); return; }
    let cancel = false;
    (async () => {
      try {
        const url = idForTask ? `/pm/tasks/${idForTask}/assignable-users` : `/pm/lists/${idForList}/assignable-users`;
        const res = await api.get(url);
        if (cancel) return;
        const users = (res.data?.data || []).map((u: any) => ({ id: u.id, display_name: u.display_name || u.email || u.id, avatar_url: u.avatar_url ?? null, email: u.email ?? null }));
        // Always keep the default reportee selectable even if not in scope.
        if (targetUserId && !users.some((u: any) => u.id === targetUserId)) {
          users.unshift({ id: targetUserId, display_name: targetUserName || targetUserId, avatar_url: null, email: null });
        }
        setScopedMembers(users);
      } catch {
        if (!cancel) setScopedMembers(null);
      }
    })();
    return () => { cancel = true; };
  }, [userOpen, hasChatScope, scopeTaskId, scopeListId, targetUserId, targetUserName]);

  // Debounced user search for changing the reportee — scoped to the
  // chat/DM or list members, never global.
  useEffect(() => {
    if (!userOpen) return;
    // Task/list scope is client-filtered from the loaded members.
    if (!hasChatScope && (scopeTaskId || scopeListId)) {
      const q = userQuery.trim().toLowerCase();
      if (!scopedMembers) { setUserResults([]); setUserSearching(true); return; }
      setUserSearching(false);
      setUserResults(
        scopedMembers.filter((u) =>
          !q || (u.display_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q),
        ).slice(0, 10),
      );
      return;
    }
    const q = userQuery.trim();
    setUserSearching(true);
    const t = setTimeout(async () => {
      try {
        const params: Record<string, string | number> = { q, limit: 10 };
        if (channelId) params.channel_id = channelId;
        else if (dmConversationId) params.dm_conversation_id = dmConversationId;
        const res = await api.get('/users/search', { params });
        let users = res.data?.data || [];
        // /users/search excludes self — still include the default reportee
        // so it stays selectable when it matches the query.
        if (targetUserId && q.length > 0) {
          const name = (targetUserName || '').toLowerCase();
          if (name.includes(q.toLowerCase()) && !users.some((u: any) => u.id === targetUserId)) {
            users = [{ id: targetUserId, display_name: targetUserName || targetUserId }, ...users];
          }
        }
        setUserResults(users);
      } catch {
        setUserResults([]);
      } finally {
        setUserSearching(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [userQuery, userOpen, targetUserId, targetUserName, channelId, dmConversationId, hasChatScope, scopeTaskId, scopeListId, scopedMembers]);

  const handleSubmit = async () => {
    if (!selectedRuleId || !reporteeId) return;
    try {
      const res = await report.mutateAsync({
        rule_id: selectedRuleId,
        user_id: reporteeId,
        reason: reason.trim() || undefined,
        source_kind: sourceKind,
        source_id: sourceId,
      });
      onReported?.(res);
      onClose();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed to report');
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-[var(--sh-hair)] bg-[var(--surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[16px] font-semibold text-[var(--sh-ink)]">Report SOP breach</h2>
        <p className="mt-1 text-[12.5px] text-[var(--sh-ink-3)]">
          Reporting <b className="text-[var(--sh-ink)]">{reporteeName}</b> — choose which SOP / page was broken.
        </p>

        <div className="mt-4">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--sh-ink-3)]">Report against</label>
          <div className="relative">
            <input
              value={userOpen ? userQuery : reporteeName}
              onFocus={() => { setUserQuery(''); setUserOpen(true); }}
              onChange={(e) => { setUserQuery(e.target.value); setUserOpen(true); }}
              onBlur={() => setTimeout(() => setUserOpen(false), 150)}
              placeholder="Search to change user…"
              className="w-full rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--sh-ink)] placeholder:text-[var(--sh-ink-3)] focus:border-[var(--sh-ink)] focus:outline-none"
            />
            {userOpen && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-auto rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] shadow-lg">
                {userSearching && userResults.length === 0 ? (
                  <div className="px-3 py-2 text-[12px] text-[var(--sh-ink-3)]">Searching…</div>
                ) : userResults.length === 0 ? (
                  <div className="px-3 py-2 text-[12px] text-[var(--sh-ink-3)]">No members found in this {hasChatScope ? 'chat' : 'list'}…</div>
                ) : (
                  userResults.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setReporteeId(u.id);
                        setReporteeName(u.display_name || u.email || u.id);
                        setUserQuery('');
                        setUserOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-[var(--sh-hair-3)] ${u.id === reporteeId ? 'font-semibold text-[var(--sh-ink)]' : 'text-[var(--sh-ink-2)]'}`}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--sh-hair-3)] text-[10px] font-bold text-[var(--sh-ink-2)]">
                        {(u.display_name || u.email || '?').slice(0, 2).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{u.display_name || u.email || u.id}</span>
                      {u.id === reporteeId && <span className="text-[11px] text-[var(--sh-ink-3)]">✓</span>}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {reporteeId !== targetUserId && (
            <button
              type="button"
              onClick={() => { setReporteeId(targetUserId); setReporteeName(targetUserName || targetUserId); setUserQuery(''); }}
              className="mt-1 text-[11.5px] text-[var(--sh-ink-3)] underline hover:text-[var(--sh-ink)]"
            >
              Reset to {targetUserName || 'message person'}
            </button>
          )}
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--sh-ink-3)]">SOP / Page</label>
          {isLoading ? (
            <div className="text-[12px] text-[var(--sh-ink-3)]">Loading SOPs…</div>
          ) : !rules || rules.length === 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              No SOP enforcement rules configured yet. A document admin can add them from Resources on the SOP (Enforcement).
            </div>
          ) : (
            <select
              value={selectedRuleId}
              onChange={(e) => setSelectedRuleId(e.target.value)}
              className="w-full rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--sh-ink)] focus:border-[var(--sh-ink)] focus:outline-none"
            >
              <option value="">— Select SOP —</option>
              {rules.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.item_title || r.item_id}
                  {r.lesson_title ? ` › ${r.lesson_title}` : ''}
                  {` — ${r.severity} · ${r.window_value} ${r.window_unit}s · ${r.flag_threshold} flags → ${r.strike_points} pt`}
                </option>
              ))}
            </select>
          )}
          {selectedRuleId && (() => {
            const r: any = rules?.find((x: any) => x.id === selectedRuleId);
            if (!r) return null;
            return (
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                <span className={`rounded-full px-2 py-0.5 font-semibold ${r.severity === 'high' ? 'bg-red-50 text-red-700' : r.severity === 'medium' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{r.severity.toUpperCase()}</span>
                <span className="rounded-full bg-[var(--sh-hair-3)] px-2 py-0.5 text-[var(--sh-ink-3)]">{r.flag_threshold} flags / {r.window_value} {r.window_unit}{r.window_value > 1 ? 's' : ''} → {r.strike_points} strike pt</span>
              </div>
            );
          })()}
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--sh-ink-3)]">Reason (optional)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="What was done incorrectly?"
            className="w-full rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-[13px] placeholder:text-[var(--sh-ink-3)] focus:border-[var(--sh-ink)] focus:outline-none"
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-[var(--sh-hair)] px-4 py-2 text-[13px] text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)]">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!selectedRuleId || !reporteeId || report.isPending}
            className="rounded-md bg-red-600 px-5 py-2 text-[13px] font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {report.isPending ? 'Reporting…' : 'Flag user'}
          </button>
        </div>
      </div>
    </div>
  );
}
