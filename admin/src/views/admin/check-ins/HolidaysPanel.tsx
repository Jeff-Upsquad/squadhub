import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import type { Holiday } from '@squadhub/shared';

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function HolidaysPanel() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    date: '',
    is_recurring: false,
    recurring_month: 1,
    recurring_day: 1,
  });
  const [activeTab, setActiveTab] = useState<'list' | 'calendar' | 'working-days'>('list');

  const { data: holidaysRes } = useQuery({
    queryKey: ['admin-holidays'],
    queryFn: () => api.get('/admin/checkin/holidays').then((r) => r.data),
  });
  const holidays: Holiday[] = holidaysRes?.data || [];

  const { data: wdRes } = useQuery({
    queryKey: ['admin-working-days'],
    queryFn: () => api.get('/admin/checkin/working-days').then((r) => r.data),
  });
  const workingDays: number[] = wdRes?.data?.working_days || [1, 2, 3, 4, 5, 6];

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/admin/checkin/holidays', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-holidays'] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.put(`/admin/checkin/holidays/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-holidays'] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/checkin/holidays/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-holidays'] }),
  });

  const updateWorkingDaysMutation = useMutation({
    mutationFn: (days: number[]) => api.put('/admin/checkin/working-days', { working_days: days }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-working-days'] }),
  });

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setFormData({ name: '', date: '', is_recurring: false, recurring_month: 1, recurring_day: 1 });
  }

  function handleEdit(h: Holiday) {
    setEditingId(h.id);
    setFormData({
      name: h.name,
      date: h.date || '',
      is_recurring: h.is_recurring,
      recurring_month: h.recurring_month || 1,
      recurring_day: h.recurring_day || 1,
    });
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      name: formData.name,
      is_recurring: formData.is_recurring,
      ...(formData.is_recurring
        ? { recurring_month: formData.recurring_month, recurring_day: formData.recurring_day }
        : { date: formData.date }),
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  function toggleWorkingDay(day: number) {
    const next = workingDays.includes(day)
      ? workingDays.filter((d) => d !== day)
      : [...workingDays, day].sort();
    updateWorkingDaysMutation.mutate(next);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-[#F1F5F9] p-1">
          {(['list', 'calendar', 'working-days'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                activeTab === tab ? 'bg-white text-[#0F172B] shadow-sm' : 'text-[#62748E] hover:text-[#0F172B]'
              }`}
            >
              {tab === 'list' ? 'Holidays' : tab === 'calendar' ? 'Calendar' : 'Working Days'}
            </button>
          ))}
        </div>
        {activeTab === 'list' && (
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="rounded-lg bg-[#0F172B] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D293D]"
          >
            Add Holiday
          </button>
        )}
      </div>

      {activeTab === 'working-days' && (
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-6">
          <h3 className="mb-4 text-sm font-semibold text-[#0F172B]">Default Working Days</h3>
          <p className="mb-4 text-xs text-[#62748E]">Toggle which days of the week are working days. Check-ins will only be tracked on working days.</p>
          <div className="flex gap-3">
            {DAY_NAMES.map((name, i) => (
              <button
                key={i}
                onClick={() => toggleWorkingDay(i)}
                className={`flex h-14 w-14 flex-col items-center justify-center rounded-lg border transition ${
                  workingDays.includes(i)
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-[#E2E8F0] bg-white text-[#90A1B9]'
                }`}
              >
                <span className="text-xs font-medium">{name}</span>
                <span className="mt-0.5 text-[9px]">{workingDays.includes(i) ? 'On' : 'Off'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'list' && (
        <div className="rounded-xl border border-[#E2E8F0] bg-white">
          {holidays.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#90A1B9]">No holidays configured yet</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#E2E8F0] text-left">
                  <th className="px-5 py-3 text-xs font-medium text-[#62748E]">Name</th>
                  <th className="px-5 py-3 text-xs font-medium text-[#62748E]">Date</th>
                  <th className="px-5 py-3 text-xs font-medium text-[#62748E]">Type</th>
                  <th className="px-5 py-3 text-xs font-medium text-[#62748E] text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {holidays.map((h) => (
                  <tr key={h.id} className="border-b border-[#E2E8F0] last:border-0">
                    <td className="px-5 py-3 text-sm text-[#0F172B]">{h.name}</td>
                    <td className="px-5 py-3 text-sm text-[#62748E]">
                      {h.is_recurring
                        ? `${MONTH_NAMES[h.recurring_month!]} ${h.recurring_day} (every year)`
                        : h.date}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        h.is_recurring ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {h.is_recurring ? 'Recurring' : 'One-time'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => handleEdit(h)}
                        className="mr-2 text-xs text-[#62748E] hover:text-[#0F172B]"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => { if (confirm(`Delete "${h.name}"?`)) deleteMutation.mutate(h.id); }}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'calendar' && (
        <CalendarTab holidays={holidays} workingDays={workingDays} />
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-base font-semibold text-[#0F172B]">
              {editingId ? 'Edit Holiday' : 'Add Holiday'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-[#62748E]">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                  className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_recurring}
                    onChange={(e) => setFormData((p) => ({ ...p, is_recurring: e.target.checked }))}
                    className="rounded border-[#CBD5E1]"
                  />
                  <span className="text-sm text-[#0F172B]">Recurring annually</span>
                </label>
              </div>

              {formData.is_recurring ? (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="mb-1 block text-xs font-medium text-[#62748E]">Month</label>
                    <select
                      value={formData.recurring_month}
                      onChange={(e) => setFormData((p) => ({ ...p, recurring_month: parseInt(e.target.value) }))}
                      className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
                    >
                      {MONTH_NAMES.slice(1).map((m, i) => (
                        <option key={i + 1} value={i + 1}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <div className="w-24">
                    <label className="mb-1 block text-xs font-medium text-[#62748E]">Day</label>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={formData.recurring_day}
                      onChange={(e) => setFormData((p) => ({ ...p, recurring_day: parseInt(e.target.value) }))}
                      className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-xs font-medium text-[#62748E]">Date</label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData((p) => ({ ...p, date: e.target.value }))}
                    className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
                    required={!formData.is_recurring}
                  />
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={resetForm} className="flex-1 rounded-lg border border-[#E2E8F0] py-2 text-sm text-[#62748E] hover:bg-[#F8FAFC]">
                  Cancel
                </button>
                <button type="submit" className="flex-1 rounded-lg bg-[#0F172B] py-2 text-sm font-medium text-white hover:bg-[#1D293D]">
                  {editingId ? 'Update' : 'Add'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function CalendarTab({ holidays, workingDays }: { holidays: Holiday[]; workingDays: number[] }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();

  const holidayDates = new Set<number>();
  holidays.forEach((h) => {
    if (h.is_recurring && h.recurring_month === month + 1) {
      holidayDates.add(h.recurring_day!);
    } else if (!h.is_recurring && h.date) {
      const d = new Date(h.date + 'T00:00:00Z');
      if (d.getUTCFullYear() === year && d.getUTCMonth() === month) {
        holidayDates.add(d.getUTCDate());
      }
    }
  });

  const cells = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => { if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1); }} className="rounded p-1 hover:bg-[#F1F5F9]">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h4 className="text-sm font-semibold text-[#0F172B]">{MONTH_NAMES[month + 1]} {year}</h4>
        <button onClick={() => { if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1); }} className="rounded p-1 hover:bg-[#F1F5F9]">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {DAY_NAMES.map((d) => (
          <div key={d} className="py-1 text-center text-[10px] font-medium uppercase tracking-wider text-[#90A1B9]">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`pad-${i}`} />;
          const dayOfWeek = new Date(year, month, day).getDay();
          const isNonWorking = !workingDays.includes(dayOfWeek);
          const isHoliday = holidayDates.has(day);

          const holidayName = holidays.find((h) => {
            if (h.is_recurring && h.recurring_month === month + 1 && h.recurring_day === day) return true;
            if (!h.is_recurring && h.date) {
              const d2 = new Date(h.date + 'T00:00:00Z');
              return d2.getUTCFullYear() === year && d2.getUTCMonth() === month && d2.getUTCDate() === day;
            }
            return false;
          })?.name;

          return (
            <div
              key={day}
              className={`flex h-10 items-center justify-center rounded text-xs font-medium ${
                isHoliday
                  ? 'bg-red-100 text-red-600'
                  : isNonWorking
                  ? 'bg-gray-100 text-gray-400'
                  : 'bg-emerald-50 text-emerald-700'
              }`}
              title={isHoliday ? holidayName : isNonWorking ? 'Non-working day' : 'Working day'}
            >
              {day}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-center gap-4">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-emerald-50 border border-emerald-200" />
          <span className="text-[10px] text-[#90A1B9]">Working</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-gray-100" />
          <span className="text-[10px] text-[#90A1B9]">Non-working</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-red-100" />
          <span className="text-[10px] text-[#90A1B9]">Holiday</span>
        </div>
      </div>
    </div>
  );
}
