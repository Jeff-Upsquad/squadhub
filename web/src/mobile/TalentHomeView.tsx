'use client';

import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';

type TalentHomeTab = 'subscriptions' | 'assignments' | 'jobs';

function TalentHomeTabs({ active, onChange }: { active: TalentHomeTab; onChange: (t: TalentHomeTab) => void }) {
  const tabs: Array<{ key: TalentHomeTab; label: string; count: number }> = [
    { key: 'subscriptions', label: 'Subscriptions', count: 14 },
    { key: 'assignments', label: 'Assignments', count: 3 },
    { key: 'jobs', label: 'Jobs', count: 4 },
  ];
  return (
    <div className="flex w-full items-center gap-1 rounded-xl border border-[#E7E7EA] bg-[#F5F5F6] p-1.5">
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <button key={t.key} type="button" onClick={() => onChange(t.key)} className={`flex min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-1.5 py-2 text-[12px] font-semibold ${isActive ? 'bg-white text-[#0a0a0a] shadow' : 'text-[#525252]'}`}>
            <span className="truncate">{t.label}</span>
            <span className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold ${isActive ? 'bg-[#FFFAC2] text-[#0a0a0a]' : 'bg-[#E7E7EA] text-[#525252]'}`}>{t.count}</span>
          </button>
        );
      })}
    </div>
  );
}

const MOCK_CARDS: Record<TalentHomeTab, Array<{ id: string; brand: string; title: string; subtitle: string }>> = {
  subscriptions: [
    { id: '1', brand: 'Harigovind g', title: 'Harigovind g — Designer plus Editor — Plus', subtitle: 'Designer plus Editor · Plus' },
    { id: '2', brand: 'AdmireCreations', title: 'AdmireCreations — Designers — Personal', subtitle: 'Designers · Personal' },
  ],
  assignments: [
    { id: '3', brand: 'Acme Corp', title: 'Acme — Video Editor', subtitle: 'Short-form edits · 3 days' },
  ],
  jobs: [
    { id: '4', brand: 'UpSquad', title: 'Operations Associate', subtitle: 'Full-time · Kerala' },
  ],
};

export default function TalentHomeView() {
  const user = useAuthStore((s) => s.user);
  const firstName = user?.display_name?.split(' ')[0] ?? 'John';
  const [tab, setTab] = useState<TalentHomeTab>('subscriptions');
  const cards = MOCK_CARDS[tab];

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
        <TalentHomeTabs active={tab} onChange={setTab} />
      </div>

      <div className="rounded-xl bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">WhatsApp updates</span>
          <span className="h-6 w-10 rounded-full bg-green-500" />
        </div>
        <p className="mt-1 text-xs text-[#737373]">Get a WhatsApp message when a new opportunity arrives.</p>
      </div>

      <div className="flex gap-2 overflow-x-auto">
        <button className="rounded-full bg-white px-4 py-2 text-sm font-semibold shadow">Pending 14</button>
        <button className="rounded-full bg-[#F5F5F6] px-4 py-2 text-sm text-[#525252]">Bidding 1</button>
        <button className="rounded-full bg-[#F5F5F6] px-4 py-2 text-sm text-[#525252]">Responded</button>
        <button className="rounded-full bg-[#F5F5F6] px-4 py-2 text-sm text-[#525252]">Expired</button>
      </div>

      <div className="space-y-3">
        {cards.map((c) => (
          <div key={c.id} className="rounded-2xl border border-[#E7E7EA] bg-white p-4">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[#F5F5F6] px-2 py-1 text-[10px] font-semibold uppercase">New offer</span>
              <span className="rounded-full bg-[#F5F5F6] px-2 py-1 text-[10px] uppercase">Subscription</span>
            </div>
            <p className="mt-3 text-sm font-semibold text-[#0a0a0a]">{c.title}</p>
            <p className="text-xs text-[#737373]">{c.subtitle}</p>
            <div className="mt-3 rounded-xl bg-[#F5F5F6] p-3">
              <p className="text-xs font-medium">4 hrs/day · 24 hrs/week · 96 hrs/month</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
