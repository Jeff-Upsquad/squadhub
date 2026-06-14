'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Overview from './check-ins/Overview';
import HistoryPanel from './check-ins/HistoryPanel';
import ChecklistsPanel from './check-ins/ChecklistsPanel';
import DeadlinesPanel from './check-ins/DeadlinesPanel';
import OfficeTimingPanel from './check-ins/OfficeTimingPanel';
import HolidaysPanel from './check-ins/HolidaysPanel';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'history', label: 'History' },
  { id: 'checklists', label: 'Checklists' },
  { id: 'deadlines', label: 'Deadlines' },
  { id: 'office-timing', label: 'Virtual Office Timing' },
  { id: 'holidays', label: 'Holidays' },
] as const;

type TabId = typeof TABS[number]['id'];

function isTabId(s: string | null | undefined): s is TabId {
  return !!s && TABS.some((t) => t.id === s);
}

function AdminCheckInsInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: TabId = isTabId(tabParam) ? tabParam : 'overview';

  function setTab(id: TabId) {
    const params = new URLSearchParams(searchParams.toString());
    if (id === 'overview') {
      params.delete('tab');
    } else {
      params.set('tab', id);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Daily Check-Ins</h1>
        <p className="mt-1 text-sm text-foreground-muted">Attendance overview, history, checklists, deadlines, virtual office timing, and holidays — all in one place.</p>
      </div>

      <div className="mb-5 flex gap-1 overflow-x-auto rounded-lg bg-canvas p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium whitespace-nowrap transition ${
              activeTab === t.id ? 'bg-surface text-foreground shadow-sm' : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && <Overview />}
      {activeTab === 'history' && <HistoryPanel />}
      {activeTab === 'checklists' && <ChecklistsPanel />}
      {activeTab === 'deadlines' && <DeadlinesPanel />}
      {activeTab === 'office-timing' && <OfficeTimingPanel />}
      {activeTab === 'holidays' && <HolidaysPanel />}
    </div>
  );
}

export default function AdminCheckIns() {
  // Suspense boundary required by Next.js 15 for useSearchParams
  return (
    <Suspense fallback={<div className="rounded-xl border border-divider bg-surface p-12 text-center text-sm text-foreground-dim">Loading…</div>}>
      <AdminCheckInsInner />
    </Suspense>
  );
}
