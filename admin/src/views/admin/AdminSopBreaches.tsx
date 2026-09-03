'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';

export default function AdminSopBreaches() {
  const [tab, setTab] = useState<'summary' | 'flags' | 'strikes'>('summary');
  const [userFilter, setUserFilter] = useState('');

  const { data: summaryRes, isLoading: sLoading } = useQuery({
    queryKey: ['admin-sop-summary'],
    queryFn: () => api.get('/sop-breaches/admin/summary').then((r) => r.data),
    enabled: tab === 'summary',
  });
  const { data: flagsRes, isLoading: fLoading } = useQuery({
    queryKey: ['admin-sop-flags', userFilter],
    queryFn: () => api.get(`/sop-breaches/admin/flags${userFilter ? `?user_id=${userFilter}` : ''}`).then((r) => r.data),
    enabled: tab === 'flags',
  });
  const { data: strikesRes, isLoading: stLoading } = useQuery({
    queryKey: ['admin-sop-strikes', userFilter],
    queryFn: () => api.get(`/sop-breaches/admin/strikes${userFilter ? `?user_id=${userFilter}` : ''}`).then((r) => r.data),
    enabled: tab === 'strikes',
  });

  const summary: any[] = summaryRes?.data || [];
  const flags: any[] = flagsRes?.data || [];
  const strikes: any[] = strikesRes?.data || [];

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-foreground">SOP breaches — flags & strikes</h1>
      <p className="mt-1 text-[12.5px] text-foreground-dim">Track who broke which SOP, how many flags within the window, and resulting strikes.</p>

      <div className="mt-4 flex gap-2 border-b border-divider">
        {(['summary','flags','strikes'] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-[13px] font-medium capitalize ${tab === k ? 'border-b-2 border-ink text-foreground' : 'text-foreground-muted'}`}>{k}</button>
        ))}
      </div>

      {tab === 'summary' && (
        <div className="mt-4">
          {sLoading ? <p className="text-sm text-foreground-dim">Loading…</p> : summary.length === 0 ? <p className="text-sm text-foreground-dim">No breaches yet.</p> : (
            <div className="overflow-x-auto rounded-xl border border-divider bg-surface">
              <table className="w-full text-left text-[12.5px]">
                <thead className="bg-canvas text-[11px] uppercase tracking-wider text-foreground-dim">
                  <tr><th className="px-4 py-2">User</th><th className="px-4 py-2">Flags</th><th className="px-4 py-2">Strikes</th><th className="px-4 py-2">Points</th></tr>
                </thead>
                <tbody>
                  {summary.map((row) => (
                    <tr key={row.user_id} className="border-t border-divider hover:bg-canvas">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          {row.user?.avatar_url ? <img src={row.user.avatar_url} alt="" className="h-6 w-6 rounded-full" /> : <span className="grid h-6 w-6 place-items-center rounded-full bg-canvas text-[10px]">{row.user?.display_name?.[0] || '?'}</span>}
                          <span>{row.user?.display_name || row.user?.email || row.user_id}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2">{row.flags}</td>
                      <td className="px-4 py-2">{row.strikes}</td>
                      <td className="px-4 py-2 font-semibold">{row.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'flags' && (
        <div className="mt-4 space-y-3">
          {fLoading ? <p className="text-sm text-foreground-dim">Loading…</p> : flags.length === 0 ? <p className="text-sm text-foreground-dim">No flags yet.</p> : flags.map((f) => (
            <div key={f.id} className="rounded-xl border border-divider bg-surface p-3">
              <div className="flex items-center gap-2 text-[12px]">
                <span className={`h-2 w-2 rounded-full ${f.rule?.severity === 'high' ? 'bg-red-500' : f.rule?.severity === 'medium' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                <span className="font-medium">{f.user?.display_name || f.user_id}</span>
                <span className="text-foreground-dim">flagged by {f.reporter?.display_name || f.reporter_id}</span>
                <span className="ml-auto text-[11px] text-foreground-dim">{new Date(f.created_at).toLocaleString()}</span>
              </div>
              <p className="mt-1 text-[12px] text-foreground-muted">
                Rule: {f.rule ? `${f.rule.severity} · ${f.rule.window_value} ${f.rule.window_unit}s · ${f.rule.flag_threshold}→${f.rule.strike_points}pt` : f.rule_id}
                {f.reason ? ` — ${f.reason}` : ''}
              </p>
              <a href={`/admin/learning/${f.item_id}`} className="mt-1 inline-block text-[11px] text-ink hover:underline">View SOP →</a>
            </div>
          ))}
        </div>
      )}

      {tab === 'strikes' && (
        <div className="mt-4 space-y-3">
          {stLoading ? <p className="text-sm text-foreground-dim">Loading…</p> : strikes.length === 0 ? <p className="text-sm text-foreground-dim">No strikes yet.</p> : strikes.map((s) => (
            <div key={s.id} className="rounded-xl border border-red-200 bg-red-50 p-3">
              <div className="flex items-center gap-2 text-[12px]">
                <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{s.points} pt</span>
                <span className="font-medium">{s.user?.display_name || s.user_id}</span>
                <span className="text-red-800">{s.flag_count} flags in {s.window_value} {s.window_unit}s ({s.severity})</span>
                <span className="ml-auto text-[11px] text-red-700">{new Date(s.created_at).toLocaleString()}</span>
              </div>
              <a href={`/admin/learning/${s.rule?.item_id || ''}`} className="mt-1 inline-block text-[11px] text-red-700 hover:underline">View SOP →</a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
