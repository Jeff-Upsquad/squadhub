import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import type { UserOfficeTiming, UserType } from '@squadhub/shared';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type EligibleUserType = 'internal' | 'partner' | 'partner_employee';
const DEFAULT_LABELS: Record<EligibleUserType, string> = {
  internal: 'Office Timing',
  partner: 'Virtual Office Timing',
  partner_employee: 'Virtual Office Timing',
};

type UserRow = {
  user: {
    id: string;
    display_name: string;
    email: string;
    user_type: UserType;
    avatar_url: string | null;
  };
  timing: UserOfficeTiming | null;
};

type FormState = {
  label: string;
  from_time: string;
  to_time: string;
  working_days: number[];
  max_break_minutes: number;
  is_active: boolean;
};

function emptyForm(userType: EligibleUserType): FormState {
  return {
    label: DEFAULT_LABELS[userType],
    from_time: '10:00',
    to_time: '19:00',
    working_days: [1, 2, 3, 4, 5, 6],
    max_break_minutes: 60,
    is_active: true,
  };
}

function fromTiming(t: UserOfficeTiming): FormState {
  return {
    label: t.label,
    from_time: t.from_time,
    to_time: t.to_time,
    working_days: t.working_days,
    max_break_minutes: t.max_break_minutes,
    is_active: t.is_active,
  };
}

function minutesBetween(from: string, to: string): number {
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  return (th * 60 + tm) - (fh * 60 + fm);
}

function formatHoursMinutes(mins: number): string {
  if (mins <= 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function summarizeTiming(t: UserOfficeTiming): string {
  const workingDaysLabel = t.working_days.length === 7
    ? 'Every day'
    : t.working_days.map(d => DAY_NAMES[d]).join(', ');
  return `${t.from_time} – ${t.to_time} · ${workingDaysLabel} · ${t.max_break_minutes}m break`;
}

export default function OfficeTimingPanel() {
  const queryClient = useQueryClient();
  const [userTypeFilter, setUserTypeFilter] = useState<'all' | EligibleUserType>('all');
  const [search, setSearch] = useState('');
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);

  const { data: rowsRes, isLoading } = useQuery({
    queryKey: ['admin-office-timing', userTypeFilter, search],
    queryFn: () => api
      .get('/admin/office-timing/users', {
        params: {
          ...(userTypeFilter === 'all' ? {} : { user_type: userTypeFilter }),
          ...(search ? { search } : {}),
        },
      })
      .then(r => r.data),
  });

  const rows: UserRow[] = rowsRes?.data || [];

  const saveMutation = useMutation({
    mutationFn: ({ userId, data }: { userId: string; data: FormState }) =>
      api.put(`/admin/office-timing/user/${userId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-office-timing'] });
      closeDrawer();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/admin/office-timing/user/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-office-timing'] });
      closeDrawer();
    },
  });

  function openDrawer(row: UserRow) {
    setEditingUserId(row.user.id);
    const userType = (row.user.user_type as EligibleUserType);
    setForm(row.timing ? fromTiming(row.timing) : emptyForm(userType));
  }

  function closeDrawer() {
    setEditingUserId(null);
    setForm(null);
  }

  function toggleDay(day: number) {
    if (!form) return;
    const next = form.working_days.includes(day)
      ? form.working_days.filter(d => d !== day)
      : [...form.working_days, day].sort();
    setForm({ ...form, working_days: next });
  }

  const editingRow = useMemo(() => rows.find(r => r.user.id === editingUserId) || null, [rows, editingUserId]);

  const derivedMinutes = form ? minutesBetween(form.from_time, form.to_time) : 0;
  const formError = useMemo(() => {
    if (!form) return null;
    if (!form.label.trim()) return 'Label is required';
    if (form.from_time >= form.to_time) return 'To time must be after from time';
    if (!form.working_days.length) return 'Select at least one working day';
    if (form.max_break_minutes < 0 || form.max_break_minutes > 720) return 'Break must be between 0 and 720 minutes';
    return null;
  }, [form]);

  const breakExceedsOffice = form ? form.max_break_minutes > derivedMinutes && derivedMinutes > 0 : false;

  function handleSave() {
    if (!form || !editingUserId || formError) return;
    saveMutation.mutate({ userId: editingUserId, data: form });
  }

  function handleDelete() {
    if (!editingUserId) return;
    if (!confirm('Remove this user\'s timing configuration? They\'ll fall back to the default check-in deadline.')) return;
    deleteMutation.mutate(editingUserId);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-[#F1F5F9] p-1">
          {(['all', 'internal', 'partner', 'partner_employee'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setUserTypeFilter(tab)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                userTypeFilter === tab ? 'bg-white text-[#0F172B] shadow-sm' : 'text-[#62748E] hover:text-[#0F172B]'
              }`}
            >
              {tab === 'all' ? 'All' : tab === 'internal' ? 'Internal' : tab === 'partner' ? 'Partner' : 'Partner Employee'}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name or email"
          className="w-64 rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
        />
      </div>

      <div className="rounded-xl border border-[#E2E8F0] bg-white">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-[#90A1B9]">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#90A1B9]">No eligible users found.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-left">
                <th className="px-5 py-3 text-xs font-medium text-[#62748E]">User</th>
                <th className="px-5 py-3 text-xs font-medium text-[#62748E]">Type</th>
                <th className="px-5 py-3 text-xs font-medium text-[#62748E]">Timing</th>
                <th className="px-5 py-3 text-xs font-medium text-[#62748E]">Status</th>
                <th className="px-5 py-3 text-xs font-medium text-[#62748E] text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.user.id} className="border-b border-[#E2E8F0] last:border-0">
                  <td className="px-5 py-3">
                    <div className="text-sm text-[#0F172B]">{row.user.display_name}</div>
                    <div className="text-xs text-[#90A1B9]">{row.user.email}</div>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      row.user.user_type === 'partner' ? 'bg-blue-50 text-blue-700' :
                      row.user.user_type === 'partner_employee' ? 'bg-violet-50 text-violet-700' :
                      'bg-emerald-50 text-emerald-700'
                    }`}>
                      {row.user.user_type === 'partner' ? 'Partner' :
                       row.user.user_type === 'partner_employee' ? 'Partner Employee' :
                       'Internal'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-sm text-[#62748E]">
                    {row.timing ? summarizeTiming(row.timing) : <span className="text-[#90A1B9]">— Not configured —</span>}
                  </td>
                  <td className="px-5 py-3">
                    {row.timing ? (
                      row.timing.is_active ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Active</span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">Disabled</span>
                      )
                    ) : <span className="text-xs text-[#90A1B9]">—</span>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => openDrawer(row)}
                      className="text-xs text-[#0F172B] hover:underline"
                    >
                      {row.timing ? 'Edit' : 'Configure'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editingRow && form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={closeDrawer}>
          <div
            className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-[#0F172B]">{editingRow.user.display_name}</h3>
                <p className="text-xs text-[#90A1B9]">{editingRow.user.email} · {editingRow.user.user_type}</p>
              </div>
              <button onClick={closeDrawer} className="text-[#90A1B9] hover:text-[#0F172B]" aria-label="Close">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-[#62748E]">Label</label>
                <input
                  type="text"
                  value={form.label}
                  onChange={e => setForm({ ...form, label: e.target.value })}
                  maxLength={80}
                  className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
                  placeholder="e.g. Office Timing, Virtual Office Timing"
                />
                <p className="mt-1 text-xs text-[#90A1B9]">User sees this label on their check-in widget.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-[#62748E]">From</label>
                  <input
                    type="time"
                    value={form.from_time}
                    onChange={e => setForm({ ...form, from_time: e.target.value })}
                    className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[#62748E]">To</label>
                  <input
                    type="time"
                    value={form.to_time}
                    onChange={e => setForm({ ...form, to_time: e.target.value })}
                    className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium text-[#62748E]">Working days</label>
                <div className="flex gap-2">
                  {DAY_NAMES.map((name, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleDay(i)}
                      className={`flex h-12 w-12 items-center justify-center rounded-lg border text-xs font-medium transition ${
                        form.working_days.includes(i)
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-[#E2E8F0] bg-white text-[#90A1B9]'
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-[#62748E]">Max break duration</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={720}
                    value={form.max_break_minutes}
                    onChange={e => setForm({ ...form, max_break_minutes: parseInt(e.target.value || '0', 10) })}
                    className="w-28 rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
                  />
                  <span className="text-sm text-[#62748E]">minutes / day</span>
                </div>
                {breakExceedsOffice && (
                  <p className="mt-1 text-xs text-amber-600">Heads up: max break exceeds the configured office window.</p>
                )}
              </div>

              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={e => setForm({ ...form, is_active: e.target.checked })}
                    className="rounded border-[#CBD5E1]"
                  />
                  <span className="text-sm text-[#0F172B]">Active</span>
                </label>
                <p className="mt-1 ml-6 text-xs text-[#90A1B9]">When off, the progress bar falls back to the default behaviour and the check-in deadline reverts to the per-user default.</p>
              </div>

              <div className="rounded-lg bg-[#F8FAFC] px-4 py-3">
                <div className="text-xs text-[#62748E]">Total working hours per day</div>
                <div className="mt-0.5 text-lg font-semibold text-[#0F172B]">{formatHoursMinutes(derivedMinutes)}</div>
                <div className="text-[10px] text-[#90A1B9]">(includes break time)</div>
              </div>

              {formError && (
                <div className="rounded-lg bg-red-50 px-4 py-2 text-xs text-red-600">{formError}</div>
              )}

              <div className="flex items-center justify-between gap-3 pt-2">
                {editingRow.timing ? (
                  <button
                    onClick={handleDelete}
                    disabled={deleteMutation.isPending}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    {deleteMutation.isPending ? 'Removing…' : 'Remove configuration'}
                  </button>
                ) : <span />}
                <div className="flex gap-2">
                  <button
                    onClick={closeDrawer}
                    className="rounded-lg border border-[#E2E8F0] px-4 py-2 text-sm text-[#62748E] hover:bg-[#F8FAFC]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!!formError || saveMutation.isPending}
                    className="rounded-lg bg-[#0F172B] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D293D] disabled:opacity-50"
                  >
                    {saveMutation.isPending ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
