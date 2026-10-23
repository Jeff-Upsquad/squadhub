'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { showToast } from '@/components/Toast';
import SaasShell, { SaasError, SaasNotConnected } from './SaasShell';
import { errorMessage, formatInr, isSaasNotConnected, saasActions, useSaasPlans, type SaasPlan } from './saasApi';

type Draft = { name: string; price_inr: string; free_staff_seats: string; is_default: boolean };

const EMPTY: Draft = { name: '', price_inr: '0', free_staff_seats: '0', is_default: false };
const INPUT = 'w-full rounded-lg border border-divider bg-surface px-2.5 py-1.5 text-sm text-foreground focus:outline-none';

function toDraft(p: SaasPlan): Draft {
  return { name: p.name, price_inr: String(p.price_inr ?? 0), free_staff_seats: String(p.free_staff_seats ?? 0), is_default: !!p.is_default };
}

function parseDraft(d: Draft): { ok: true; value: Omit<SaasPlan, 'id'> } | { ok: false; error: string } {
  const name = d.name.trim();
  const price = Number(d.price_inr);
  const seats = Number(d.free_staff_seats);
  if (!name) return { ok: false, error: 'Name is required' };
  if (!Number.isFinite(price) || price < 0) return { ok: false, error: 'Price must be 0 or more' };
  if (!Number.isInteger(seats) || seats < 0) return { ok: false, error: 'Free staff seats must be a whole number, 0 or more' };
  return { ok: true, value: { name, price_inr: price, free_staff_seats: seats, is_default: d.is_default } };
}

export default function SaasPlans() {
  const qc = useQueryClient();
  const { data: plans, isLoading, error, refetch } = useSaasPlans();
  const [editingId, setEditingId] = useState<string | null>(null); // 'new' for the add row
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const save = useMutation({
    mutationFn: async ({ id, value }: { id: string | null; value: Omit<SaasPlan, 'id'> }) =>
      id ? saasActions.updatePlan(id, value) : saasActions.createPlan(value),
    onSuccess: (_r, v) => {
      showToast(v.id ? 'Plan saved' : 'Plan created', 'success');
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ['admin-saas', 'plans'] });
    },
    onError: (err) => showToast(errorMessage(err, 'Could not save plan'), 'error'),
  });

  const submit = () => {
    const parsed = parseDraft(draft);
    if (!parsed.ok) {
      showToast(parsed.error, 'error');
      return;
    }
    save.mutate({ id: editingId === 'new' ? null : editingId, value: parsed.value });
  };

  const editRow = (
    <>
      <td className="px-4 py-2"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Plan name" className={INPUT} autoFocus /></td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-1">
          <span className="text-foreground-dim">₹</span>
          <input type="number" min={0} value={draft.price_inr} onChange={(e) => setDraft({ ...draft, price_inr: e.target.value })} className={`${INPUT} max-w-[110px]`} />
        </div>
      </td>
      <td className="px-4 py-2"><input type="number" min={0} step={1} value={draft.free_staff_seats} onChange={(e) => setDraft({ ...draft, free_staff_seats: e.target.value })} className={`${INPUT} max-w-[90px]`} /></td>
      <td className="px-4 py-2">
        <label className="inline-flex items-center gap-1.5 text-xs text-foreground-muted">
          <input type="checkbox" checked={draft.is_default} onChange={(e) => setDraft({ ...draft, is_default: e.target.checked })} />
          Default
        </label>
      </td>
      <td className="px-4 py-2 text-right">
        <div className="flex justify-end gap-2">
          <button onClick={() => setEditingId(null)} className="rounded-lg border border-divider px-3 py-1 text-xs text-foreground-muted hover:bg-surface-alt">Cancel</button>
          <button onClick={submit} disabled={save.isPending} className="rounded-lg bg-ink px-3 py-1 text-xs font-medium text-white hover:bg-ink-hover disabled:opacity-50">
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </td>
    </>
  );

  return (
    <SaasShell
      title="SaaS Plans"
      subtitle="Plans for Squad Hub SaaS accounts. Pricing is free for now — ₹0 is allowed. The default plan applies to new accounts."
      actions={
        <button
          onClick={() => { setDraft(EMPTY); setEditingId('new'); }}
          disabled={editingId === 'new'}
          className="rounded-lg bg-ink px-4 py-1.5 text-xs font-medium text-white hover:bg-ink-hover disabled:opacity-50"
        >
          + New plan
        </button>
      }
    >
      {error && isSaasNotConnected(error) ? (
        <SaasNotConnected />
      ) : error ? (
        <SaasError message={errorMessage(error, 'Could not load plans')} onRetry={() => refetch()} />
      ) : isLoading ? (
        <p className="py-8 text-center text-sm text-foreground-dim">Loading...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-divider bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-left text-[11px] uppercase tracking-wide text-foreground-dim">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Price / month</th>
                <th className="px-4 py-2.5 font-medium">Free staff seats</th>
                <th className="px-4 py-2.5 font-medium">Default</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {editingId === 'new' && <tr className="border-b border-divider bg-surface-alt">{editRow}</tr>}
              {(plans || []).length === 0 && editingId !== 'new' && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-foreground-dim">No plans yet. Create one to assign it to accounts.</td></tr>
              )}
              {(plans || []).map((p) =>
                editingId === p.id ? (
                  <tr key={p.id} className="border-b border-divider bg-surface-alt last:border-0">{editRow}</tr>
                ) : (
                  <tr key={p.id} className="border-b border-divider last:border-0">
                    <td className="px-4 py-3 font-medium text-foreground">{p.name}</td>
                    <td className="px-4 py-3 text-foreground-muted">{formatInr(p.price_inr)}</td>
                    <td className="px-4 py-3 text-foreground-muted">{p.free_staff_seats}</td>
                    <td className="px-4 py-3">
                      {p.is_default ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Default</span>
                      ) : (
                        <button
                          onClick={() => save.mutate({ id: p.id, value: { name: p.name, price_inr: p.price_inr, free_staff_seats: p.free_staff_seats, is_default: true } })}
                          disabled={save.isPending}
                          className="text-xs text-foreground-dim hover:text-foreground hover:underline disabled:opacity-50"
                        >
                          Make default
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => { setDraft(toDraft(p)); setEditingId(p.id); }}
                        className="rounded-lg border border-divider px-3 py-1 text-xs font-medium text-foreground-muted hover:bg-surface-alt hover:text-foreground"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </SaasShell>
  );
}
