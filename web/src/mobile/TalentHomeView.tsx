'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SubscriptionCardRecipient } from '@squadhub/shared';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { MIcon } from './MobileKit';

type TalentHomeTab = 'subscriptions' | 'assignments' | 'jobs';
type ProductTab = 'subscription' | 'assignment' | 'hiring';

// Mirrors Profiles/frontend/src/views/talent/TalentDashboard.tsx + TalentHomeTabs.tsx 1:1
function TalentHomeTabs({ active, onChange, counts }: { active: TalentHomeTab; onChange: (t: TalentHomeTab) => void; counts: Record<TalentHomeTab, number> }) {
  const tabs: Array<{ key: TalentHomeTab; label: string }> = [
    { key: 'subscriptions', label: 'Subscriptions' },
    { key: 'assignments', label: 'Assignments' },
    { key: 'jobs', label: 'Jobs' },
  ];
  return (
    <div className="flex w-full items-center gap-1 rounded-xl border border-[#E7E7EA] bg-[#F5F5F6] p-1.5" role="tablist" aria-label="Home sections">
      {tabs.map((t) => {
        const isActive = active === t.key;
        const c = counts[t.key] ?? 0;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-1.5 py-2 text-[12px] font-semibold transition-all md:gap-1.5 md:px-3 md:text-[13px] ${isActive ? 'bg-white text-[#0a0a0a] shadow-[0_1px_3px_rgba(0,0,0,0.1)]' : 'text-[#525252] hover:text-[#0a0a0a]'}`}
          >
            <span className="min-w-0 truncate">{t.label}</span>
            {c > 0 && (
              <span className={`inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold md:h-5 md:min-w-5 md:px-1.5 md:text-[11px] ${isActive ? 'bg-[#FFFAC2] text-[#0a0a0a]' : 'bg-[#E7E7EA] text-[#525252]'}`}>
                {c > 99 ? '99+' : c}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function cardType(r: SubscriptionCardRecipient): ProductTab {
  const t = (r.card as any)?.card_type;
  return t === 'assignment' || t === 'hiring' ? t : 'subscription';
}

export default function TalentHomeView() {
  const user = useAuthStore((s) => s.user);
  const firstName = user?.display_name?.split(' ')[0] ?? user?.email?.split('@')[0] ?? '';
  const [tab, setTab] = useState<TalentHomeTab>('subscriptions');

  const { data, isLoading } = useQuery({
    queryKey: ['partner-opportunities-discover'],
    queryFn: async () => {
      const res = await Promise.all(
        ['pending', 'accepted', 'rejected'].map((s) => api.get(`/partner/opportunities?status=${s}`).then((r) => r.data?.data || [])),
      );
      return res.flat() as SubscriptionCardRecipient[];
    },
    staleTime: 20_000,
  });

  const all = useMemo(() => {
    const arr = data || [];
    return arr.filter((it, idx, rows) => rows.findIndex((r) => r.id === it.id) === idx);
  }, [data]);

  const counts = useMemo(() => {
    const c = { subscriptions: 0, assignments: 0, jobs: 0 } as Record<TalentHomeTab, number>;
    for (const it of all) {
      const t = cardType(it);
      if (t === 'subscription') c.subscriptions += 1;
      else if (t === 'assignment') c.assignments += 1;
      else c.jobs += 1;
    }
    return c;
  }, [all]);

  const visible = useMemo(() => {
    const want: ProductTab = tab === 'subscriptions' ? 'subscription' : tab === 'assignments' ? 'assignment' : 'hiring';
    return all.filter((it) => cardType(it) === want);
  }, [all, tab]);

  return (
    <div className="space-y-6 bg-[#F5F5F6] p-3">
      {/* Hero — exact copy of TalentDashboard hero */}
      <section className="hero-container hero-glow-orange relative overflow-hidden rounded-2xl border border-[#E7E7EA] bg-white px-5 py-5 sm:px-7 sm:py-6">
        <div className="hero-glow-blur absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(600px 200px at 20% 0%, rgba(255,250,194,0.6), transparent 60%)' }} />
        <div className="hero-content relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <div className="mb-2 inline-flex items-center gap-2">
              <span className="rounded-full bg-[#F5F5F6] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#0a0a0a]">Talent Workspace</span>
              <span className="rounded-full bg-[#0a0a0a] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white">Live</span>
            </div>
            <h1 className="text-[24px] font-semibold tracking-[-0.025em] leading-[1.15] text-[#0a0a0a] sm:text-[28px]">
              Welcome back{firstName ? <>, <span className="bg-gradient-to-r from-[#5B5BF2] to-[#F48FB1] bg-clip-text text-transparent">{' '}{firstName}</span></> : ''}.
            </h1>
            <p className="mt-1 text-sm text-[#525252]">Subscriptions, assignments, and job openings in one place.</p>
          </div>
        </div>
      </section>

      {/* Onboarding strip — simplified (matches TalentDashboard OnboardingStageStrip) */}
      <section className="rounded-2xl border border-[#E7E7EA] bg-white px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-[-0.015em] text-[#0a0a0a]">Your onboarding journey</h2>
            <p className="mt-0.5 text-xs text-[#737373]">Complete each stage to unlock the full talent workspace.</p>
          </div>
        </div>
        <div className="flex items-start justify-between gap-2 sm:gap-4">
          {[
            { k: 'Sign-up', done: true },
            { k: 'Course', done: true },
            { k: 'Basic', done: false },
            { k: 'Job', done: false },
            { k: 'Portfolio', done: false },
          ].map((s, i) => (
            <div key={s.k} className="flex items-start gap-2 sm:gap-4">
              <div className="flex flex-col items-center gap-1.5">
                <span className="flex h-6 w-6 items-center justify-center">
                  {s.done ? (
                    <svg className="h-6 w-6 text-green-500" viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" /></svg>
                  ) : (
                    <span className="h-5 w-5 rounded-full border-2 border-gray-300 bg-white" />
                  )}
                </span>
                <span className={`text-[11px] font-medium leading-none ${s.done ? 'text-[#0a0a0a]' : 'text-[#a3a3a3]'}`}>{s.k}</span>
              </div>
              {i < 4 && <span className={`mt-3 h-0.5 w-6 sm:w-10 ${s.done ? 'bg-green-300' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>
      </section>

      <div className="sticky top-0 z-10 -mx-3 bg-[#F5F5F6]/95 px-3 py-2 backdrop-blur-sm">
        <TalentHomeTabs active={tab} onChange={setTab} counts={counts} />
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-[#E7E7EA] bg-white p-6 text-center text-sm text-[#737373]">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-[#E7E7EA] bg-white px-5 py-10 text-center">
          <p className="text-sm font-semibold text-[#0a0a0a]">No {tab} yet</p>
          <p className="mt-1 text-sm text-[#737373]">New {tab} will appear here when businesses post them.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => {
            const card = r.card as any;
            const title = card?.brand_name || card?.submission_subscription?.subscription?.name || (tab === 'jobs' ? 'New job opening' : tab === 'assignments' ? 'New assignment' : 'New subscription');
            const meta = [card?.submission?.business_name, card?.submission_subscription?.plan?.plan].filter(Boolean).join(' · ');
            const price = card?.partner_price_override ?? card?.proposed_price;
            return (
              <div key={r.id} className="rounded-2xl border border-[#E7E7EA] bg-white p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5F5F6] text-[#525252]">{MIcon.calendar}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#a3a3a3]">{tab === 'subscriptions' ? 'Subscription' : tab === 'assignments' ? 'Assignment' : 'Job opening'}</p>
                    <p className="mt-0.5 truncate text-[15px] font-semibold text-[#0a0a0a]">{title}</p>
                    {meta && <p className="mt-0.5 truncate text-xs text-[#737373]">{meta}</p>}
                    <p className="mt-2 text-xs font-medium text-[#0a0a0a]">{price != null ? `₹${Number(price).toLocaleString('en-IN')}` : 'Open brief'}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
