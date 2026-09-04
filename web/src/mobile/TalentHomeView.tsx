'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SubscriptionCardRecipient } from '@squadhub/shared';
import { useAuthStore } from '../stores/authStore';
import api from '../services/api';
import {
  RequestCard,
  RequestSheet,
  cardType,
  fetchTalentOpportunities,
  stageFor,
  type OpportunityCard,
  type ProductTab,
  type StageTab,
} from './MobileDiscover';

type TalentHomeTab = 'subscriptions' | 'assignments' | 'jobs';
type TalentHomeStage = StageTab | 'bidding';

const PRODUCT_BY_TAB: Record<TalentHomeTab, ProductTab> = {
  subscriptions: 'subscription',
  assignments: 'assignment',
  jobs: 'hiring',
};

function TalentHomeTabs({ active, counts, onChange }: { active: TalentHomeTab; counts: Record<TalentHomeTab, number>; onChange: (t: TalentHomeTab) => void }) {
  const tabs: Array<{ key: TalentHomeTab; label: string; count: number }> = [
    { key: 'subscriptions', label: 'Subscriptions', count: counts.subscriptions },
    { key: 'assignments', label: 'Assignments', count: counts.assignments },
    { key: 'jobs', label: 'Jobs', count: counts.jobs },
  ];
  return (
    <div className="flex w-full items-center gap-1 rounded-xl border border-[#E7E7EA] bg-[#F5F5F6] p-1.5">
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <button key={t.key} type="button" onClick={() => onChange(t.key)} className={`flex min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-1.5 py-2 text-[12px] font-semibold ${isActive ? 'bg-white text-[#0a0a0a] shadow' : 'text-[#525252]'}`}>
            <span className="truncate">{t.label}</span>
            {t.count > 0 && <span className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold ${isActive ? 'bg-[#FFFAC2] text-[#0a0a0a]' : 'bg-[#E7E7EA] text-[#525252]'}`}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export default function TalentHomeView() {
  const user = useAuthStore((s) => s.user);
  const firstName = user?.display_name?.split(' ')[0] ?? 'John';
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TalentHomeTab>('subscriptions');
  const [stage, setStage] = useState<TalentHomeStage>('pending');
  const [selected, setSelected] = useState<SubscriptionCardRecipient | null>(null);

  const query = useQuery({
    queryKey: ['partner-opportunities-discover'],
    queryFn: fetchTalentOpportunities,
    staleTime: 20_000,
  });
  const all = useMemo(
    () => (query.data || []).filter((item, index, rows) => rows.findIndex((row) => row.id === item.id) === index),
    [query.data],
  );
  const product = PRODUCT_BY_TAB[tab];
  const productItems = useMemo(() => all.filter((item) => cardType(item) === product), [all, product]);
  const cards = useMemo(() => productItems.filter((item) => homeStageFor(item) === stage), [productItems, stage]);
  const productCounts = useMemo(() => ({
    subscriptions: all.filter((item) => cardType(item) === 'subscription' && homeStageFor(item) === 'pending').length,
    assignments: all.filter((item) => cardType(item) === 'assignment' && homeStageFor(item) === 'pending').length,
    jobs: all.filter((item) => cardType(item) === 'hiring' && homeStageFor(item) === 'pending').length,
  }), [all]);
  const stageCounts = useMemo(() => ({
    pending: productItems.filter((item) => homeStageFor(item) === 'pending').length,
    bidding: productItems.filter((item) => homeStageFor(item) === 'bidding').length,
    responded: productItems.filter((item) => homeStageFor(item) === 'responded').length,
    expired: productItems.filter((item) => homeStageFor(item) === 'expired').length,
  }), [productItems]);

  const respond = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'reject' }) =>
      api.patch(`/partner/discover/opportunities/${id}/respond`, { action }),
    onSuccess: async () => {
      setSelected(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['partner-opportunities-discover'] }),
        queryClient.invalidateQueries({ queryKey: ['partner-opportunities'] }),
        queryClient.invalidateQueries({ queryKey: ['partner-opportunities-pending'] }),
      ]);
    },
  });

  return (
    <div className="space-y-4 bg-[#F5F5F6] p-3">
      <section className="relative overflow-hidden rounded-2xl border border-[#E7E7EA] bg-white px-5 py-5">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(600px 200px at 20% 0%, rgba(255,250,194,0.6), transparent 60%)' }} />
        <div className="relative">
          <div className="mb-2 inline-flex items-center gap-2">
            <span className="rounded-full bg-[#F5F5F6] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#0a0a0a]">Talent Workspace</span>
            <span className="rounded-full bg-[#0a0a0a] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white">Live</span>
          </div>
          <h1 className="text-[22px] font-semibold tracking-[-0.025em] text-[#0a0a0a]">Welcome back, <span className="bg-[#FFFAC2] px-1">{firstName}</span>.</h1>
          <p className="mt-1 text-sm text-[#525252]">Subscriptions, assignments, and job openings in one place.</p>
        </div>
      </section>

      <section className="rounded-2xl border border-[#E7E7EA] bg-white px-5 py-4">
        <h2 className="text-sm font-semibold text-[#0a0a0a]">Your onboarding journey</h2>
        <p className="mt-0.5 text-xs text-[#737373]">Complete each stage to unlock the full talent workspace.</p>
        <div className="mt-3 flex items-start justify-between gap-2">
          {[
            { k: 'Sign-up', done: true },
            { k: 'Course', done: true },
            { k: 'Basic', done: false },
            { k: 'Job', done: true },
            { k: 'Portfolio', done: true },
          ].map((s, i) => (
            <div key={s.k} className="flex items-start gap-2">
              <div className="flex flex-col items-center gap-1.5">
                <span className="flex h-6 w-6 items-center justify-center">{s.done ? <svg className="h-6 w-6 text-green-500" viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" /></svg> : <span className="h-5 w-5 rounded-full border-2 border-gray-300 bg-white" />}</span>
                <span className={`text-[11px] font-medium ${s.done ? 'text-[#0a0a0a]' : 'text-[#a3a3a3]'}`}>{s.k}</span>
              </div>
              {i < 4 && <span className={`mt-3 h-0.5 w-5 ${s.done ? 'bg-green-300' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>
      </section>

      <div className="bg-transparent py-1">
        <TalentHomeTabs active={tab} counts={productCounts} onChange={(nextTab) => { setTab(nextTab); setStage('pending'); }} />
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-[#E7E7EA] bg-white px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-[#0a0a0a]">WhatsApp updates</p>
          <p className="mt-0.5 text-xs leading-relaxed text-[#737373]">Get a WhatsApp message when a new opportunity arrives. Throttled so you won&apos;t be spammed if several arrive at once.</p>
        </div>
        <label className="relative ml-3 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full bg-[#22C55E] p-0.5">
          <span className="inline-block h-5 w-5 translate-x-5 rounded-full bg-white shadow" />
          <input type="checkbox" className="sr-only" defaultChecked readOnly />
        </label>
      </div>

      <div className="flex flex-wrap gap-1 rounded-2xl border border-[#E7E7EA] bg-[#F5F5F6] p-1.5" role="tablist" aria-label="Opportunity status">
        {(['pending', 'bidding', 'responded', 'expired'] as TalentHomeStage[]).map((item) => {
          const active = stage === item;
          return (
            <button key={item} type="button" role="tab" aria-selected={active} onClick={() => setStage(item)} className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 ${active ? 'bg-white shadow-sm' : ''}`}>
              <span className={`text-[13px] capitalize ${active ? 'font-semibold text-[#0a0a0a]' : 'font-medium text-[#737373]'}`}>{item}</span>
              {stageCounts[item] > 0 && <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${active ? 'bg-[#FFFAC2] text-[#0a0a0a]' : 'bg-[#E7E7EA] text-[#525252]'}`}>{stageCounts[item]}</span>}
            </button>
          );
        })}
      </div>

      <div className="mdiscover-list" aria-live="polite">
        {query.isLoading ? (
          <div className="mdiscover-skeletons" aria-label="Loading opportunities"><i /><i /></div>
        ) : query.isError ? (
          <button type="button" onClick={() => query.refetch()} className="rounded-xl border border-[#E7E7EA] bg-white p-5 text-left">
            <span className="block text-sm font-semibold text-[#0a0a0a]">Couldn&apos;t load opportunities</span>
            <span className="mt-1 block text-xs text-[#737373]">Tap to try again.</span>
          </button>
        ) : cards.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#D8D8DC] bg-white px-5 py-8 text-center">
            <p className="text-sm font-semibold text-[#0a0a0a]">Nothing here yet</p>
            <p className="mt-1 text-xs text-[#737373]">New opportunities and your responses will appear here.</p>
          </div>
        ) : cards.map((item) => (
          <RequestCard key={item.id} recipient={item} onClick={() => setSelected(item)} />
        ))}
      </div>

      {selected && (
        <RequestSheet
          recipient={selected}
          busy={respond.isPending}
          error={(respond.error as any)?.response?.data?.error || (respond.isError ? 'We couldn\'t save your response.' : null)}
          onClose={() => setSelected(null)}
          onRespond={(action) => respond.mutate({ id: selected.id, action })}
        />
      )}
    </div>
  );
}

function homeStageFor(recipient: SubscriptionCardRecipient): TalentHomeStage {
  const stage = stageFor(recipient);
  const card = recipient.card as OpportunityCard | undefined;
  if (stage === 'responded' && recipient.status === 'accepted' && card?.state !== 'assigned') return 'bidding';
  return stage;
}
