import { useState } from 'react';
import ApplicationsTab from './ApplicationsTab';
import InterviewsTab from './InterviewsTab';
import OnboardingTab from './OnboardingTab';
import PublicFormsPanel from './PublicFormsPanel';

const TABS = [
  { id: 'applications', label: 'Applications' },
  { id: 'interviews', label: 'Interview Responses' },
  { id: 'onboarding', label: 'Onboarding' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function CandidatesPage() {
  const [tab, setTab] = useState<TabId>('applications');
  const [formsOpen, setFormsOpen] = useState(false);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-6">
        {/* Top tabs (mirrors SquadHire's Applications / Interview Responses / Onboarding) + Public Forms */}
        <div className="flex items-end justify-between gap-3 border-b border-divider">
          <div className="flex gap-2">
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
          <button
            onClick={() => setFormsOpen(true)}
            className="mb-1.5 inline-flex flex-shrink-0 items-center gap-2 rounded-lg border border-divider bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
            Public Forms
          </button>
        </div>

        {tab === 'applications' && <ApplicationsTab />}
        {tab === 'interviews' && <InterviewsTab />}
        {tab === 'onboarding' && <OnboardingTab />}
      </div>

      <PublicFormsPanel open={formsOpen} onClose={() => setFormsOpen(false)} />
    </div>
  );
}
