'use client';
import { useState } from 'react';
import { useAllSopRules, useReportBreach } from '../../hooks/useSopBreaches';

interface Props {
  targetUserId: string;
  targetUserName?: string;
  sourceKind?: 'task' | 'message' | 'manual';
  sourceId?: string;
  onClose: () => void;
  onReported?: (info: { sop_label: string; count_in_window: number; threshold: number; window_label: string; severity: string; strike_points: number; is_strike: boolean; sop_link: string }) => void;
}

export default function SopBreachReportModal({ targetUserId, targetUserName, sourceKind = 'manual', sourceId, onClose, onReported }: Props) {
  const { data: rules, isLoading } = useAllSopRules();
  const report = useReportBreach();
  const [selectedRuleId, setSelectedRuleId] = useState<string>('');
  const [reason, setReason] = useState('');

  const handleSubmit = async () => {
    if (!selectedRuleId) return;
    try {
      const res = await report.mutateAsync({
        rule_id: selectedRuleId,
        user_id: targetUserId,
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
          Reporting <b className="text-[var(--sh-ink)]">{targetUserName || targetUserId}</b> — choose which SOP / page was broken.
        </p>

        <div className="mt-4">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--sh-ink-3)]">SOP / Page</label>
          {isLoading ? (
            <div className="text-[12px] text-[var(--sh-ink-3)]">Loading SOPs…</div>
          ) : !rules || rules.length === 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              No SOP enforcement rules configured yet. Ask an admin to set up rules for an SOP page first (severity, time window, threshold).
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
            disabled={!selectedRuleId || report.isPending}
            className="rounded-md bg-red-600 px-5 py-2 text-[13px] font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {report.isPending ? 'Reporting…' : 'Flag user'}
          </button>
        </div>
      </div>
    </div>
  );
}
