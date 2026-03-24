import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import type { Subscription, SubscriptionSquad, SubscriptionLevel, SubscriptionPlan } from '@squadhub/shared';
import SliderPanel from './SliderPanel';

const SQUADS: SubscriptionSquad[] = [
  'Content Squad', 'Accounts & Finance Squad', 'Marketing Squad',
  'Tech Squad', 'Legal Squad', 'Hiring & HR Squad',
];
const LEVELS: SubscriptionLevel[] = ['Junior', 'Pro', 'Elite'];
const PLANS: SubscriptionPlan[] = ['Starter', 'Basic', 'Plus', 'Pro', 'Personal'];

const SQUAD_COLORS: Record<string, string> = {
  'Content Squad': 'bg-purple-100 text-purple-700',
  'Accounts & Finance Squad': 'bg-emerald-100 text-emerald-700',
  'Marketing Squad': 'bg-blue-100 text-blue-700',
  'Tech Squad': 'bg-orange-100 text-orange-700',
  'Legal Squad': 'bg-rose-100 text-rose-700',
  'Hiring & HR Squad': 'bg-amber-100 text-amber-700',
};

const LEVEL_COLORS: Record<string, string> = {
  'Junior': 'bg-slate-100 text-slate-600',
  'Pro': 'bg-indigo-100 text-indigo-700',
  'Elite': 'bg-yellow-100 text-yellow-700',
};

export default function SubscriptionsModule() {
  const queryClient = useQueryClient();
  const [sliderOpen, setSliderOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    name: '', squad: SQUADS[0] as SubscriptionSquad, level: LEVELS[0] as SubscriptionLevel, plan: PLANS[0] as SubscriptionPlan, price: 0,
  });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const { data: subscriptionsRes, isLoading } = useQuery({
    queryKey: ['admin-subscriptions'],
    queryFn: () => api.get('/admin/clients/subscriptions').then((r) => r.data),
  });
  const subscriptions: Subscription[] = subscriptionsRes?.data || [];

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/admin/clients/subscriptions', data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-subscriptions'] }); closeSlider(); },
    onError: (err: any) => { alert(err?.response?.data?.error || err.message || 'Failed to create subscription'); },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.put(`/admin/clients/subscriptions/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-subscriptions'] }); closeSlider(); },
    onError: (err: any) => { alert(err?.response?.data?.error || err.message || 'Failed to update subscription'); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/clients/subscriptions/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-subscriptions'] }); setDeleteConfirm(null); },
  });

  function openCreate() {
    setEditingId(null);
    setForm({ name: '', squad: SQUADS[0], level: LEVELS[0], plan: PLANS[0], price: 0 });
    setSliderOpen(true);
  }

  function openEdit(sub: Subscription) {
    setEditingId(sub.id);
    setForm({ name: sub.name, squad: sub.squad, level: sub.level, plan: sub.plan, price: sub.price });
    setSliderOpen(true);
  }

  function closeSlider() {
    setSliderOpen(false);
    setEditingId(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: form });
    } else {
      createMutation.mutate(form);
    }
  }

  const filtered = subscriptions.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.squad.toLowerCase().includes(search.toLowerCase()) ||
    s.level.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#0F172B]">Subscriptions</h1>
          <p className="mt-1 text-sm text-[#62748E]">Manage service subscriptions offered to clients</p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-lg bg-[#0F172B] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1E293B]"
        >
          + New Subscription
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search subscriptions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#0F172B] placeholder-[#90A1B9] focus:border-[#2962FF] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
        />
      </div>

      {/* List */}
      {isLoading ? (
        <p className="py-8 text-center text-sm text-[#90A1B9]">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-[#E2E8F0] bg-white py-12 text-center">
          <p className="text-sm text-[#90A1B9]">{search ? 'No matching subscriptions.' : 'No subscriptions yet. Create your first one.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((sub) => (
            <div
              key={sub.id}
              className="flex items-center justify-between rounded-lg border border-[#E2E8F0] bg-white px-5 py-4 transition hover:shadow-sm"
            >
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-sm font-medium text-[#0F172B]">{sub.name}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${SQUAD_COLORS[sub.squad] || 'bg-slate-100 text-slate-600'}`}>
                      {sub.squad}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${LEVEL_COLORS[sub.level] || 'bg-slate-100 text-slate-600'}`}>
                      {sub.level}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-[#0F172B]">{'\u20B9'}{sub.price.toLocaleString('en-IN')}/mo</span>
                <button onClick={() => openEdit(sub)} className="rounded-md p-1.5 text-[#90A1B9] hover:bg-[#F1F5F9] hover:text-[#0F172B]">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                  </svg>
                </button>
                {deleteConfirm === sub.id ? (
                  <div className="flex items-center gap-1">
                    <button onClick={() => deleteMutation.mutate(sub.id)} className="rounded-md bg-red-500 px-2 py-1 text-xs text-white hover:bg-red-600">Confirm</button>
                    <button onClick={() => setDeleteConfirm(null)} className="rounded-md bg-[#F1F5F9] px-2 py-1 text-xs text-[#62748E] hover:bg-[#E2E8F0]">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setDeleteConfirm(sub.id)} className="rounded-md p-1.5 text-[#90A1B9] hover:bg-red-50 hover:text-red-500">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Slider */}
      <SliderPanel open={sliderOpen} onClose={closeSlider} title={editingId ? 'Edit Subscription' : 'New Subscription'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[#62748E]">Name *</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Social Media Management"
              className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#62748E]">Squad *</label>
            <select
              required
              value={form.squad}
              onChange={(e) => setForm({ ...form, squad: e.target.value as SubscriptionSquad })}
              className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
            >
              {SQUADS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#62748E]">Level *</label>
            <select
              required
              value={form.level}
              onChange={(e) => setForm({ ...form, level: e.target.value as SubscriptionLevel })}
              className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
            >
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#62748E]">Plan *</label>
            <select
              required
              value={form.plan}
              onChange={(e) => setForm({ ...form, plan: e.target.value as SubscriptionPlan })}
              className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
            >
              {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#62748E]">Price ({'\u20B9'}/month) *</label>
            <input
              type="number"
              required
              min={0}
              value={form.price}
              onChange={(e) => setForm({ ...form, price: parseInt(e.target.value) || 0 })}
              className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
            />
          </div>
          <div className="pt-4">
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="w-full rounded-lg bg-[#0F172B] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1E293B] disabled:opacity-50"
            >
              {createMutation.isPending || updateMutation.isPending ? 'Saving...' : editingId ? 'Update Subscription' : 'Create Subscription'}
            </button>
          </div>
        </form>
      </SliderPanel>
    </div>
  );
}
