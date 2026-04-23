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
          <h3 className="text-lg font-semibold text-[#0F172B]">Review Queue</h3>
          <p className="text-sm text-[#64748B]">Review and mark entries as &quot;Posted to Books&quot;</p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'entries' && selectedEntries.size > 0 && (
            <button
              onClick={() => postEntriesMutation.mutate(Array.from(selectedEntries))}
              disabled={postEntriesMutation.isPending}
              className="rounded-md bg-[#2962FF] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#1E50D8] disabled:opacity-50"
            >
              Mark {selectedEntries.size} as Posted
            </button>
          )}
          {activeTab === 'checks' && selectedChecks.size > 0 && (
            <button
              onClick={() => postChecksMutation.mutate(Array.from(selectedChecks))}
              disabled={postChecksMutation.isPending}
              className="rounded-md bg-[#2962FF] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#1E50D8] disabled:opacity-50"
            >
              Mark {selectedChecks.size} as Posted
            </button>
          )}
        </div>
      </div>

      {/* Tab toggle */}
      <div className="mb-4 flex gap-1 rounded-lg bg-[#F1F5F9] p-1">
        <button
          onClick={() => setActiveTab('entries')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === 'entries' ? 'bg-white text-[#0F172B] shadow-sm' : 'text-[#64748B]'
          }`}
        >
          Cash Entries ({entries.length})
        </button>
        <button
          onClick={() => setActiveTab('checks')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === 'checks' ? 'bg-white text-[#0F172B] shadow-sm' : 'text-[#64748B]'
          }`}
        >
          Check Entries ({checks.length})
        </button>
      </div>

      {/* Entries table */}
      {activeTab === 'entries' && (
        <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                <th className="px-4 py-2.5 text-left">
                  <input
                    type="checkbox"
                    checked={entries.length > 0 && selectedEntries.size === entries.length}
                    onChange={selectAllEntries}
                    className="rounded border-[#CBD5E1]"
                  />
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-[#64748B]">Date</th>
                <th className="px-4 py-2.5 text-left font-medium text-[#64748B]">Client</th>
                <th className="px-4 py-2.5 text-left font-medium text-[#64748B]">Staff</th>
                <th className="px-4 py-2.5 text-left font-medium text-[#64748B]">Type</th>
                <th className="px-4 py-2.5 text-right font-medium text-[#64748B]">Amount</th>
                <th className="px-4 py-2.5 text-left font-medium text-[#64748B]">Party</th>
                <th className="px-4 py-2.5 text-left font-medium text-[#64748B]">Description</th>
                <th className="px-4 py-2.5 text-left font-medium text-[#64748B]">Photo</th>
              </tr>
            </thead>
            <tbody>
              {entriesLoading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-[#94A3B8]">Loading...</td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-[#94A3B8]">All entries have been posted!</td>
                </tr>
              ) : (
                entries.map((entry: any) => (
                  <tr key={entry.id} className={`border-b border-[#F1F5F9] ${selectedEntries.has(entry.id) ? 'bg-[#EEF2FF]' : 'hover:bg-[#F8FAFC]'}`}>
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedEntries.has(entry.id)}
                        onChange={() => toggleEntry(entry.id)}
                        className="rounded border-[#CBD5E1]"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-[#0F172B]">{entry.entry_date}</td>
                    <td className="px-4 py-2.5 text-[#475569]">{entry.client?.business_name || '-'}</td>
                    <td className="px-4 py-2.5 text-[#475569]">{entry.user?.display_name || '-'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        entry.entry_type === 'cash_in' ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-[#FEF2F2] text-[#DC2626]'
                      }`}>
                        {entry.entry_type === 'cash_in' ? 'In' : 'Out'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-[#0F172B]">
                      {Number(entry.amount).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                    </td>
                    <td className="px-4 py-2.5 text-[#475569]">{entry.party_name || '-'}</td>
                    <td className="max-w-[150px] truncate px-4 py-2.5 text-[#475569]">{entry.description || '-'}</td>
                    <td className="px-4 py-2.5">
                      {entry.photo_key ? (
                        <button
                          type="button"
                          onClick={() => openSignedPhoto(entry.photo_key)}
                          className="text-[#2962FF] underline"
                        >
                          View
                        </button>
                      ) : (
                        <span className="text-[#CBD5E1]">-</span>
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
        <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                <th className="px-4 py-2.5 text-left">
                  <input
                    type="checkbox"
                    checked={checks.length > 0 && selectedChecks.size === checks.length}
                    onChange={selectAllChecks}
                    className="rounded border-[#CBD5E1]"
                  />
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-[#64748B]">Date</th>
                <th className="px-4 py-2.5 text-left font-medium text-[#64748B]">Client</th>
                <th className="px-4 py-2.5 text-left font-medium text-[#64748B]">Type</th>
                <th className="px-4 py-2.5 text-left font-medium text-[#64748B]">Check #</th>
                <th className="px-4 py-2.5 text-left font-medium text-[#64748B]">Bank</th>
                <th className="px-4 py-2.5 text-left font-medium text-[#64748B]">Party</th>
                <th className="px-4 py-2.5 text-right font-medium text-[#64748B]">Amount</th>
                <th className="px-4 py-2.5 text-left font-medium text-[#64748B]">Status</th>
              </tr>
            </thead>
            <tbody>
              {checksLoading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-[#94A3B8]">Loading...</td>
                </tr>
              ) : checks.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-[#94A3B8]">All checks have been posted!</td>
                </tr>
              ) : (
                checks.map((check: any) => (
                  <tr key={check.id} className={`border-b border-[#F1F5F9] ${selectedChecks.has(check.id) ? 'bg-[#EEF2FF]' : 'hover:bg-[#F8FAFC]'}`}>
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedChecks.has(check.id)}
                        onChange={() => toggleCheck(check.id)}
                        className="rounded border-[#CBD5E1]"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-[#0F172B]">{check.check_date}</td>
                    <td className="px-4 py-2.5 text-[#475569]">{check.client?.business_name || '-'}</td>
                    <td className="px-4 py-2.5 capitalize text-[#475569]">{check.check_type}</td>
                    <td className="px-4 py-2.5 font-mono text-[#0F172B]">{check.check_number}</td>
                    <td className="px-4 py-2.5 text-[#475569]">{check.bank_name}</td>
                    <td className="px-4 py-2.5 text-[#475569]">{check.party_name}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-[#0F172B]">
                      {Number(check.amount).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                    </td>
                    <td className="px-4 py-2.5 capitalize">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        check.status === 'cleared' ? 'bg-[#DCFCE7] text-[#16A34A]' :
                        check.status === 'bounced' ? 'bg-[#FEF2F2] text-[#DC2626]' :
                        check.status === 'deposited' ? 'bg-[#DBEAFE] text-[#1D4ED8]' :
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
