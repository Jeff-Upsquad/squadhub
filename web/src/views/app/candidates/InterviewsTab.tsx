import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type { InterviewInvitation, InterviewInvitationsResponse } from '@squadhub/shared';
import api from '../../../services/api';
import { showToast } from '../../../components/Toast';
import { Chip, formatPhone, type Tone } from './helpers';
import CandidateSidePanel from './CandidateSidePanel';
import { useAllowedCategories } from './useAllowedCategories';

type StatusFilter = 'submitted' | 'pending' | 'expired' | 'all';

const CATEGORY_TABS = [
  { value: 'creative', label: 'Creative' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'sales', label: 'Sales' },
];
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'pending', label: 'Pending' },
  { value: 'expired', label: 'Expired' },
  { value: 'all', label: 'All' },
];
const STATUS_TONE: Record<'submitted' | 'pending' | 'expired', Tone> = {
  submitted: 'green',
  pending: 'amber',
  expired: 'red',
};

function rowStatus(row: InterviewInvitation): 'submitted' | 'pending' | 'expired' {
  if (row.submitted_at) return 'submitted';
  if (new Date(row.expires_at).getTime() < Date.now()) return 'expired';
  return 'pending';
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function InterviewsTab() {
  const queryClient = useQueryClient();
  const [formType, setFormType] = useState('');
  const [status, setStatus] = useState<StatusFilter>('submitted');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const { data: allowed } = useAllowedCategories();
  const restricted = !!allowed && allowed.length < 3;
  const tabs = useMemo(() => {
    const cats = allowed ?? CATEGORY_TABS.map((t) => t.value);
    const catTabs = CATEGORY_TABS.filter((t) => cats.includes(t.value));
    return restricted ? catTabs : [{ value: '', label: 'All' }, ...catTabs];
  }, [allowed, restricted]);

  useEffect(() => {
    if (restricted && allowed && !allowed.includes(formType)) {
      setFormType(allowed[0]);
      setPage(1);
    }
  }, [restricted, allowed, formType]);

  const queryKey = ['candidates-interviews', formType, status, search, page];
  const { data, isLoading } = useQuery<InterviewInvitationsResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (formType) params.set('form_type', formType);
      params.set('status', status);
      if (search) params.set('search', search);
      params.set('page', String(page));
      params.set('limit', '25');
      return (await api.get(`/candidates/interviews?${params.toString()}`)).data;
    },
    placeholderData: keepPreviousData,
    enabled: !!allowed && (!restricted || allowed.includes(formType)),
  });

  const reviewedMutation = useMutation({
    mutationFn: async ({ id, reviewed }: { id: string; reviewed: boolean }) => {
      await api.patch(`/candidates/interviews/${id}/reviewed`, { reviewed });
    },
    onMutate: async ({ id, reviewed }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<InterviewInvitationsResponse>(queryKey);
      if (previous) {
        queryClient.setQueryData<InterviewInvitationsResponse>(queryKey, {
          ...previous,
          invitations: previous.invitations.map((row) =>
            row.id === id ? { ...row, reviewed_at: reviewed ? new Date().toISOString() : null } : row,
          ),
        });
      }
      return { previous };
    },
    onError: (err: unknown, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryKey, ctx.previous);
      const e = err as { response?: { data?: { error?: string } } };
      showToast(e?.response?.data?.error || 'Failed to update');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const rows = data?.invitations ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Interview Responses</h1>
        <p className="mt-1 text-sm text-foreground-muted">Review first-level interview submissions across all candidates.</p>
      </div>

      <div className="flex w-fit gap-1 rounded-lg bg-canvas p-1">
        {tabs.map((tab) => (
          <button
            key={tab.value || 'all'}
            onClick={() => { setFormType(tab.value); setPage(1); }}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              formType === tab.value ? 'bg-surface text-foreground shadow-sm' : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <label className="mb-1 block text-xs font-medium text-foreground-muted">Status</label>
          <select
            className="block w-full rounded-lg border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-[var(--color-accent)] focus:outline-none"
            value={status}
            onChange={(e) => { setStatus(e.target.value as StatusFilter); setPage(1); }}
          >
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="w-64">
          <label className="mb-1 block text-xs font-medium text-foreground-muted">Search</label>
          <input
            placeholder="Search by name, email, phone…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="block w-full rounded-lg border border-divider bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-dim focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-divider bg-surface">
        <table className="min-w-full divide-y divide-divider">
          <thead className="bg-canvas">
            <tr>
              <th className="w-10 px-4 py-3 text-left text-xs font-medium uppercase text-foreground-muted" title="Mark as reviewed">Done</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-foreground-muted">Candidate</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-foreground-muted">Phone</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-foreground-muted">Email</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-foreground-muted">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-foreground-muted">Submitted</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-foreground-muted">Responses</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-4 w-full animate-pulse rounded bg-foreground/10" /></td></tr>
              ))
            ) : !rows.length ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-foreground-muted">No interview responses match your filters.</td></tr>
            ) : (
              rows.map((row) => {
                const rs = rowStatus(row);
                const isReviewed = !!row.reviewed_at;
                return (
                  <tr
                    key={row.id}
                    className={`cursor-pointer transition-colors hover:bg-canvas ${isReviewed ? 'text-foreground-muted' : ''}`}
                    onClick={() => setSelectedLeadId(row.lead_id)}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isReviewed}
                        disabled={reviewedMutation.isPending}
                        onChange={(e) => reviewedMutation.mutate({ id: row.id, reviewed: e.target.checked })}
                        title={isReviewed && row.reviewed_at ? `Reviewed on ${fmtDate(row.reviewed_at)}` : 'Mark as reviewed'}
                        className="h-4 w-4 cursor-pointer rounded border-divider accent-[var(--color-accent)]"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className={`text-sm font-medium ${isReviewed ? 'text-foreground-muted line-through' : 'text-foreground'}`}>{row.lead_name}</div>
                      <div className="text-xs text-foreground-dim">via {row.form_type}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">{formatPhone(row.lead_phone)}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">{row.lead_email || '—'}</td>
                    <td className="px-4 py-3"><Chip tone={STATUS_TONE[rs]}>{rs.charAt(0).toUpperCase() + rs.slice(1)}</Chip></td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">{row.submitted_at ? fmtDate(row.submitted_at) : '—'}</td>
                    <td className="px-4 py-3 text-sm text-foreground">{row.submitted_at ? `${row.response_count} answer${row.response_count === 1 ? '' : 's'}` : '—'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {data && data.total_pages > 1 && (
        <div className="flex items-center justify-between text-sm text-foreground-muted">
          <span>Page {data.page} of {data.total_pages} ({data.total} total)</span>
          <div className="flex gap-2">
            <button
              className="rounded-lg border border-divider px-3 py-1.5 text-sm text-foreground hover:bg-canvas disabled:opacity-50"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <button
              className="rounded-lg border border-divider px-3 py-1.5 text-sm text-foreground hover:bg-canvas disabled:opacity-50"
              disabled={page >= data.total_pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      <CandidateSidePanel
        candidateId={selectedLeadId}
        onClose={() => setSelectedLeadId(null)}
        onNavigate={() => {}}
        hasPrev={false}
        hasNext={false}
        currentIndex={null}
        totalCount={0}
      />
    </div>
  );
}
