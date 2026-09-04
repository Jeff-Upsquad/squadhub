'use client';

import { useAuthStore } from '../stores/authStore';
import MobileDiscover from './MobileDiscover';

export default function TalentHomeView({ onNav }: { onNav?: (tab: 'chat' | 'notifications' | 'more') => void } = {}) {
  const user = useAuthStore((s) => s.user);
  const firstName = user?.display_name?.split(' ')[0] ?? user?.email?.split('@')[0] ?? '';

  return (
    <div className="space-y-3 bg-[#F5F5F6] p-3">
      {/* Hero — exact copy of Profiles/frontend/src/views/talent/TalentDashboard.tsx:156 */}
      <section className="relative overflow-hidden rounded-2xl border border-[#E7E7EA] bg-white px-5 py-5 sm:px-7 sm:py-6">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(600px 200px at 20% 0%, rgba(255,250,194,0.6), transparent 60%)' }} />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
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

      {/* Onboarding strip — simplified to avoid extra hooks; matches talent web */}
      <section className="rounded-2xl border border-[#E7E7EA] bg-white px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="mb-3">
          <h2 className="text-base font-semibold tracking-[-0.015em] text-[#0a0a0a]">Your onboarding journey</h2>
          <p className="mt-0.5 text-xs text-[#737373]">Complete each stage to unlock the full talent workspace.</p>
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

      <MobileDiscover
        hideTopNav
        onNavigate={(dest) => {
          if (!onNav) return;
          if (dest === 'chat') onNav('chat');
          else if (dest === 'notifications') onNav('notifications');
          else if (dest === 'more') onNav('more');
        }}
      />
    </div>
  );
}
