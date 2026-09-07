'use client';
import { useEffect, useState } from 'react';
import { useSopRules, useUpsertSopRule, useDeleteSopRule } from '../../hooks/useSopBreaches';

type RuleForm = {
  lesson_id: string | null;
  severity: 'low' | 'medium' | 'high';
  window_value: number;
  window_unit: 'minute' | 'hour' | 'day' | 'week' | 'month';
  flag_threshold: number;
  strike_points: number;
};

const EMPTY: RuleForm = {
  lesson_id: null,
  severity: 'medium',
  window_value: 30,
  window_unit: 'day',
  flag_threshold: 3,
  strike_points: 1,
};

function severityDot(s: string) {
  return s === 'high' ? 'bg-red-500' : s === 'medium' ? 'bg-amber-500' : 'bg-emerald-500';
}

type LessonOpt = { id: string; title: string; parent_lesson_id?: string | null };

function pageLabel(lessons: LessonOpt[], id: string): string {
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const parts: string[] = [];
  const seen = new Set<string>();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.unshift(cur.title);
    cur = cur.parent_lesson_id ? byId.get(cur.parent_lesson_id) : undefined;
  }
  return parts.join(' › ') || id;
}

export default function SopEnforcementEditor({
  itemId,
  lessons,
  initialLessonId,
  onClose,
}: {
  itemId: string;
  lessons: LessonOpt[];
  initialLessonId?: string | null;
  onClose?: () => void;
}) {
  const { data: rules, isLoading } = useSopRules(itemId);
  const upsert = useUpsertSopRule();
  const del = useDeleteSopRule();
  const [form, setForm] = useState<RuleForm>({ ...EMPTY, lesson_id: initialLessonId || null });

  useEffect(() => {
    setForm((f) => ({ ...f, lesson_id: initialLessonId || null }));
  }, [initialLessonId]);

  const saveError =
    (upsert.error as any)?.response?.data?.error
    || (upsert.error as any)?.message
    || 'Failed to save rule';

  function loadRule(r: { lesson_id: string | null; severity: RuleForm['severity']; window_value: number; window_unit: RuleForm['window_unit']; flag_threshold: number; strike_points: number }) {
    setForm({
      lesson_id: r.lesson_id,
      severity: r.severity,
      window_value: r.window_value,
      window_unit: r.window_unit,
      flag_threshold: r.flag_threshold,
      strike_points: Number(r.strike_points),
    });
  }

  function handleSave() {
    upsert.mutate({
      item_id: itemId,
      lesson_id: form.lesson_id,
      severity: form.severity,
      window_value: form.window_value,
      window_unit: form.window_unit,
      flag_threshold: form.flag_threshold,
      strike_points: form.strike_points,
      is_active: true,
    });
  }

  const inputClass = 'w-full rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-2 py-1.5 text-[12px] text-[var(--sh-ink)] outline-none focus:border-[var(--sh-ink)]';

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--sh-hair)] px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sh-ink-3)]">SOP enforcement</div>
            <p className="mt-0.5 text-[11px] leading-snug text-[var(--sh-ink-3)]">
              Document admins only. Each page gets a rule: severity, window, flag threshold, and strike points.
            </p>
          </div>
          {onClose && (
            <button onClick={onClose} className="shrink-0 text-[12px] text-[var(--sh-ink-3)] hover:text-[var(--sh-ink)]">Close</button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {isLoading ? (
          <p className="text-[12px] text-[var(--sh-ink-3)]">Loading…</p>
        ) : (
          <>
            {(rules || []).length > 0 && (
              <div className="mb-3 space-y-1.5">
                {(rules || []).map((r) => {
                  const lessonTitle = r.lesson_id ? pageLabel(lessons, r.lesson_id) : 'SOP (top page)';
                  return (
                    <div key={r.id} className="flex items-center gap-2 rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${severityDot(r.severity)}`} />
                      <button
                        type="button"
                        onClick={() => loadRule(r)}
                        className="min-w-0 flex-1 truncate text-left text-[12px] text-[var(--sh-ink)] hover:underline"
                        title="Edit this rule"
                      >
                        {lessonTitle} — <b className="uppercase">{r.severity}</b> · {r.flag_threshold} flags / {r.window_value} {r.window_unit}s → {r.strike_points} pt
                      </button>
                      <button
                        onClick={() => { if (confirm('Remove this enforcement rule?')) del.mutate(r.id); }}
                        className="shrink-0 text-[11px] text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="rounded-lg border border-[var(--sh-hair)] bg-[var(--sidebar)] p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sh-ink-3)]">Add / update rule</p>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <label className="col-span-2">
                  <span className="mb-1 block text-[11px] font-medium text-[var(--sh-ink-3)]">Page</span>
                  <select
                    value={form.lesson_id || ''}
                    onChange={(e) => setForm((f) => ({ ...f, lesson_id: e.target.value || null }))}
                    className={inputClass}
                  >
                    <option value="">— SOP top page (item) —</option>
                    {lessons.map((l) => (
                      <option key={l.id} value={l.id}>{pageLabel(lessons, l.id)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-[var(--sh-ink-3)]">Severity</span>
                  <select value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value as RuleForm['severity'] }))} className={inputClass}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-[var(--sh-ink-3)]">Strike points</span>
                  <input type="number" min={0} max={100} step={0.1} value={form.strike_points} onChange={(e) => setForm((f) => ({ ...f, strike_points: Number(e.target.value) }))} className={inputClass} />
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-[var(--sh-ink-3)]">Window value</span>
                  <input type="number" min={1} max={999} value={form.window_value} onChange={(e) => setForm((f) => ({ ...f, window_value: Number(e.target.value) }))} className={inputClass} />
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-[var(--sh-ink-3)]">Window unit</span>
                  <select value={form.window_unit} onChange={(e) => setForm((f) => ({ ...f, window_unit: e.target.value as RuleForm['window_unit'] }))} className={inputClass}>
                    <option value="minute">Minute</option>
                    <option value="hour">Hour</option>
                    <option value="day">Day</option>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                  </select>
                </label>
                <label className="col-span-2">
                  <span className="mb-1 block text-[11px] font-medium text-[var(--sh-ink-3)]">Flag threshold — flags within window to trigger strike</span>
                  <input type="number" min={1} max={100} value={form.flag_threshold} onChange={(e) => setForm((f) => ({ ...f, flag_threshold: Number(e.target.value) }))} className={inputClass} />
                </label>
              </div>
              <button
                onClick={handleSave}
                disabled={upsert.isPending}
                className="mt-3 w-full rounded-md bg-[var(--sh-ink)] px-3 py-2 text-[12px] font-semibold text-[var(--sidebar)] hover:opacity-90 disabled:opacity-50"
              >
                {upsert.isPending ? 'Saving…' : 'Save rule'}
              </button>
              {upsert.isError && <p className="mt-2 text-[11px] text-red-600">{saveError}</p>}
              {upsert.isSuccess && !upsert.isPending && (
                <p className="mt-2 text-[11px] text-emerald-700">Saved.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
