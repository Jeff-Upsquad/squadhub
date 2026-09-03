'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';

type Rule = {
  id: string;
  item_id: string;
  lesson_id: string | null;
  severity: 'low' | 'medium' | 'high';
  window_value: number;
  window_unit: 'minute' | 'hour' | 'day' | 'week' | 'month';
  flag_threshold: number;
  strike_points: number;
  is_active: boolean;
};

export default function SopEnforcementEditor({ itemId, lessons }: { itemId: string; lessons: { id: string; title: string }[] }) {
  const qc = useQueryClient();
  const { data: res, isLoading } = useQuery({
    queryKey: ['sop-rules', itemId],
    queryFn: () => api.get(`/sop-breaches/rules?item_id=${itemId}`).then((r) => r.data),
  });
  const rules: Rule[] = res?.data || [];

  const [form, setForm] = useState<Partial<Rule> & { lesson_id?: string | null }>({
    lesson_id: null,
    severity: 'medium',
    window_value: 30,
    window_unit: 'day',
    flag_threshold: 3,
    strike_points: 1,
  });

  const upsert = useMutation({
    mutationFn: (body: any) => api.put('/sop-breaches/rules', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sop-rules', itemId] }),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/sop-breaches/rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sop-rules', itemId] }),
  });

  const handleSave = () => {
    upsert.mutate({
      item_id: itemId,
      lesson_id: (form.lesson_id as string) || null,
      severity: form.severity,
      window_value: form.window_value,
      window_unit: form.window_unit,
      flag_threshold: form.flag_threshold,
      strike_points: form.strike_points,
      is_active: true,
    });
  };

  const severityColor = (s: string) => s === 'high' ? 'bg-red-500' : s === 'medium' ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className="rounded-xl border border-divider bg-surface p-4">
      <h3 className="text-[13px] font-semibold text-foreground">SOP enforcement</h3>
      <p className="mt-1 text-[11.5px] leading-snug text-foreground-dim">
        Each SOP page / sub-page gets a unique rule: severity, time window (e.g. last 10 days, 1 month), flag threshold and strike points. If flag count ≥ threshold within the window, the user gets a strike.
      </p>

      {isLoading ? <p className="mt-3 text-[12px] text-foreground-dim">Loading…</p> : (
        <>
          {rules.length > 0 && (
            <div className="mt-3 space-y-2">
              {rules.map((r) => {
                const lessonTitle = r.lesson_id ? lessons.find((l) => l.id === r.lesson_id)?.title || r.lesson_id : 'SOP (top page)';
                return (
                  <div key={r.id} className="flex items-center gap-2 rounded-lg border border-divider bg-canvas px-3 py-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${severityColor(r.severity)}`} />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                      {lessonTitle} — <b className="uppercase">{r.severity}</b> · {r.flag_threshold} flags / {r.window_value} {r.window_unit}s → {r.strike_points} pt
                    </span>
                    <button onClick={() => del.mutate(r.id)} className="shrink-0 text-[11px] text-red-600 hover:underline">Remove</button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-4 rounded-lg border border-divider bg-surface-alt p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-dim">Add / update rule</p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <label className="col-span-2">
                <span className="mb-1 block text-[11px] font-medium text-foreground-dim">Page</span>
                <select
                  value={form.lesson_id || ''}
                  onChange={(e) => setForm((f) => ({ ...f, lesson_id: e.target.value || null }))}
                  className="w-full rounded-md border border-divider bg-surface px-2 py-1.5 text-[12px]"
                >
                  <option value="">— SOP top page (item) —</option>
                  {lessons.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-[11px] font-medium text-foreground-dim">Severity</span>
                <select value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value as any }))} className="w-full rounded-md border border-divider bg-surface px-2 py-1.5 text-[12px]">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label>
                <span className="mb-1 block text-[11px] font-medium text-foreground-dim">Strike points</span>
                <input type="number" min={0} max={100} value={form.strike_points} onChange={(e) => setForm((f) => ({ ...f, strike_points: Number(e.target.value) }))} className="w-full rounded-md border border-divider bg-surface px-2 py-1.5 text-[12px]" />
              </label>
              <label>
                <span className="mb-1 block text-[11px] font-medium text-foreground-dim">Window value</span>
                <input type="number" min={1} max={999} value={form.window_value} onChange={(e) => setForm((f) => ({ ...f, window_value: Number(e.target.value) }))} className="w-full rounded-md border border-divider bg-surface px-2 py-1.5 text-[12px]" />
              </label>
              <label>
                <span className="mb-1 block text-[11px] font-medium text-foreground-dim">Window unit</span>
                <select value={form.window_unit} onChange={(e) => setForm((f) => ({ ...f, window_unit: e.target.value as any }))} className="w-full rounded-md border border-divider bg-surface px-2 py-1.5 text-[12px]">
                  <option value="minute">Minute</option>
                  <option value="hour">Hour</option>
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                </select>
              </label>
              <label className="col-span-2">
                <span className="mb-1 block text-[11px] font-medium text-foreground-dim">Flag threshold — flags within window to trigger strike</span>
                <input type="number" min={1} max={100} value={form.flag_threshold} onChange={(e) => setForm((f) => ({ ...f, flag_threshold: Number(e.target.value) }))} className="w-full rounded-md border border-divider bg-surface px-2 py-1.5 text-[12px]" />
              </label>
            </div>
            <button onClick={handleSave} disabled={upsert.isPending} className="mt-3 w-full rounded-md bg-ink px-3 py-2 text-[12px] font-semibold text-white hover:bg-ink-hover disabled:opacity-50">
              {upsert.isPending ? 'Saving…' : 'Save rule'}
            </button>
            {upsert.isError && <p className="mt-2 text-[11px] text-red-600">{(upsert.error as any)?.response?.data?.error || 'Failed'}</p>}
          </div>
        </>
      )}
    </div>
  );
}
