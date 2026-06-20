import { useState } from 'react';
import ApplicationsTab from './ApplicationsTab';
import InterviewsTab from './InterviewsTab';
import OnboardingTab from './OnboardingTab';

const TABS = [
  { id: 'applications', label: 'Applications' },
  { id: 'interviews', label: 'Interview Responses' },
  { id: 'onboarding', label: 'Onboarding' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function CandidatesPage() {
  const [tab, setTab] = useState<TabId>('applications');

  return (
    <div className="space-y-6">
      {/* Top tabs (mirrors SquadHire's Applications / Interview Responses / Onboarding) */}
      <div className="flex gap-2 border-b border-divider">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                  : 'border-transparent text-foreground-muted hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'applications' && <ApplicationsTab />}
      {tab === 'interviews' && <InterviewsTab />}
      {tab === 'onboarding' && <OnboardingTab />}
    </div>
  );
}
