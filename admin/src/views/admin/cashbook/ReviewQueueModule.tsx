import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';

// Open a cashbook photo via a short-lived signed GET URL. Opens a blank
// window synchronously (so the browser's popup blocker doesn't catch it),
// then navigates it to the signed URL once the sign request returns.
async function openSignedPhoto(photoKey: string) {
  const w = window.open('', '_blank', 'noopener,noreferrer');
  try {
    const { data } = await api.get('/admin/cashbook/photo/sign', {
      params: { key: photoKey },
    });
    if (w && data?.data?.url) {
      w.location.href = data.data.url;
    } else if (w) {
      w.close();
    }
  } catch (err) {
    if (w) w.close();
    console.error('Photo sign failed:', err);
  }
}

export default function ReviewQueueModule() {
  const queryClient = useQueryClient();
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [selectedChecks, setSelectedChecks] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'entries' | 'checks'>('entries');

  // Unposted entries
  const { data: entriesRes, isLoading: entriesLoading } = useQuery({
    queryKey: ['admin-cashbook-entries-unposted'],
    queryFn: () => api.get('/admin/cashbook/entries?is_posted=false&limit=100').then((r) => r.data),
  });

  // Unposted checks
  const { data: checksRes, isLoading: checksLoading } = useQuery({
    queryKey: ['admin-cashbook-checks-unposted'],
    queryFn: () => api.get('/admin/cashbook/checks?limit=100').then((r) => r.data),
  });

  const postEntriesMutation = useMutation({
    mutationFn: (entryIds: string[]) => api.post('/admin/cashbook/entries/post', { entry_ids: entryIds }),
    onSuccess: () => {
      setSelectedEntries(new Set());
      queryClient.invalidateQueries({ queryKey: ['admin-cashbook-entries-unposted'] });
      queryClient.invalidateQueries({ queryKey: ['admin-cashbook-stats'] });
    },
  });

  const postChecksMutation = useMutation({
    mutationFn: (checkIds: string[]) => api.post('/admin/cashbook/checks/post', { check_ids: checkIds }),
    onSuccess: () => {
      setSelectedChecks(new Set());
      queryClient.invalidateQueries({ queryKey: ['admin-cashbook-checks-unposted'] });
      queryClient.invalidateQueries({ queryKey: ['admin-cashbook-stats'] });
    },
  });

  const entries = (entriesRes?.data || []);
  const checks = (checksRes?.data || []).filter((c: any) => !c.is_posted);

  const toggleEntry = (id: string) => {
    const next = new Set(selectedEntries);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedEntries(next);
  };

  const toggleCheck = (id: string) => {
    const next = new Set(selectedChecks);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedChecks(next);
  };

  const selectAllEntries = () => {
    if (selectedEntries.size === entries.length) {
      setSelectedEntries(new Set());
    } else {
      setSelectedEntries(new Set(entries.map((e: any) => e.id)));
    }
  };

  const selectAllChecks = () => {
    if (selectedChecks.size === checks.length) {
      setSelectedChecks(new Set());
    } else {
      setSelectedChecks(new Set(checks.map((c: any) => c.id)));
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Review Queue</h3>
          <p className="text-sm text-foreground-muted">Review and mark entries as &quot;Posted to Books&quot;</p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'entries' && selectedEntries.size > 0 && (
            <button
              onClick={() => postEntriesMutation.mutate(Array.from(selectedEntries))}
              disabled={postEntriesMutation.isPending}
              className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-strong disabled:opacity-50"
            >
              Mark {selectedEntries.size} as Posted
            </button>
          )}
          {activeTab === 'checks' && selectedChecks.size > 0 && (
            <button
              onClick={() => postChecksMutation.mutate(Array.from(selectedChecks))}
              disabled={postChecksMutation.isPending}
              className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-strong disabled:opacity-50"
            >
              Mark {selectedChecks.size} as Posted
            </button>
          )}
        </div>
      </div>

      {/* Tab toggle */}
      <div className="mb-4 flex gap-1 rounded-lg bg-canvas p-1">
        <button
          onClick={() => setActiveTab('entries')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === 'entries' ? 'bg-surface text-foreground shadow-sm' : 'text-foreground-muted'
          }`}
        >
          Cash Entries ({entries.length})
        </button>
        <button
          onClick={() => setActiveTab('checks')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === 'checks' ? 'bg-surface text-foreground shadow-sm' : 'text-foreground-muted'
          }`}
        >
          Check Entries ({checks.length})
        </button>
      </div>

      {/* Entries table */}
      {activeTab === 'entries' && (
        <div className="overflow-hidden rounded-lg border border-divider bg-surface">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-divider bg-surface-alt">
                <th className="px-4 py-2.5 text-left">
                  <input
                    type="checkbox"
                    checked={entries.length > 0 && selectedEntries.size === entries.length}
                    onChange={selectAllEntries}
                    className="rounded border-divider-strong"
                  />
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Date</th>
                <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Client</th>
                <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Staff</th>
                <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Type</th>
                <th className="px-4 py-2.5 text-right font-medium text-foreground-muted">Amount</th>
                <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Party</th>
                <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Description</th>
                <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Photo</th>
              </tr>
            </thead>
            <tbody>
              {entriesLoading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-foreground-dim">Loading...</td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-foreground-dim">All entries have been posted!</td>
                </tr>
              ) : (
                entries.map((entry: any) => (
                  <tr key={entry.id} className={`border-b border-divider ${selectedEntries.has(entry.id) ? 'bg-[#EEF2FF]' : 'hover:bg-surface-alt'}`}>
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedEntries.has(entry.id)}
                        onChange={() => toggleEntry(entry.id)}
                        className="rounded border-divider-strong"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-foreground">{entry.entry_date}</td>
                    <td className="px-4 py-2.5 text-foreground-muted">{entry.client?.business_name || '-'}</td>
                    <td className="px-4 py-2.5 text-foreground-muted">{entry.user?.display_name || '-'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        entry.entry_type === 'cash_in' ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-[#FEF2F2] text-[#DC2626]'
                      }`}>
                        {entry.entry_type === 'cash_in' ? 'In' : 'Out'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-foreground">
                      {Number(entry.amount).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                    </td>
                    <td className="px-4 py-2.5 text-foreground-muted">{entry.party_name || '-'}</td>
                    <td className="max-w-[150px] truncate px-4 py-2.5 text-foreground-muted">{entry.description || '-'}</td>
                    <td className="px-4 py-2.5">
                      {entry.photo_key ? (
                        <button
                          type="button"
                          onClick={() => openSignedPhoto(entry.photo_key)}
                          className="text-accent underline"
                        >
                          View
                        </button>
                      ) : (
                        <span className="text-foreground-dim">-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Checks table */}
      {activeTab === 'checks' && (
        <div className="overflow-hidden rounded-lg border border-divider bg-surface">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-divider bg-surface-alt">
                <th className="px-4 py-2.5 text-left">
                  <input
                    type="checkbox"
                    checked={checks.length > 0 && selectedChecks.size === checks.length}
                    onChange={selectAllChecks}
                    className="rounded border-divider-strong"
                  />
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Date</th>
                <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Client</th>
                <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Type</th>
                <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Check #</th>
                <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Bank</th>
                <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Party</th>
                <th className="px-4 py-2.5 text-right font-medium text-foreground-muted">Amount</th>
                <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Status</th>
              </tr>
            </thead>
            <tbody>
              {checksLoading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-foreground-dim">Loading...</td>
                </tr>
              ) : checks.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-foreground-dim">All checks have been posted!</td>
                </tr>
              ) : (
                checks.map((check: any) => (
                  <tr key={check.id} className={`border-b border-divider ${selectedChecks.has(check.id) ? 'bg-[#EEF2FF]' : 'hover:bg-surface-alt'}`}>
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedChecks.has(check.id)}
                        onChange={() => toggleCheck(check.id)}
                        className="rounded border-divider-strong"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-foreground">{check.check_date}</td>
                    <td className="px-4 py-2.5 text-foreground-muted">{check.client?.business_name || '-'}</td>
                    <td className="px-4 py-2.5 capitalize text-foreground-muted">{check.check_type}</td>
                    <td className="px-4 py-2.5 font-mono text-foreground">{check.check_number}</td>
                    <td className="px-4 py-2.5 text-foreground-muted">{check.bank_name}</td>
                    <td className="px-4 py-2.5 text-foreground-muted">{check.party_name}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-foreground">
                      {Number(check.amount).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                    </td>
                    <td className="px-4 py-2.5 capitalize">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        check.status === 'cleared' ? 'bg-[#DCFCE7] text-[#16A34A]' :
                        check.status === 'bounced' ? 'bg-[#FEF2F2] text-[#DC2626]' :
                        check.status === 'deposited' ? 'bg-[#DBEAFE] text-accent-strong' :
                        'bg-[#FEF9C3] text-[#A16207]'
                      }`}>
                        {check.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
