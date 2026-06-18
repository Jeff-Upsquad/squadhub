import { useState } from 'react';
import Overview from './Overview';
import HistoryPanel from './HistoryPanel';
import ChecklistsPanel from './ChecklistsPanel';
import DeadlinesPanel from './DeadlinesPanel';
import OfficeTimingPanel from './OfficeTimingPanel';
import HolidaysPanel from './HolidaysPanel';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'history', label: 'History' },
  { id: 'checklists', label: 'Checklists' },
  { id: 'deadlines', label: 'Deadlines' },
  { id: 'office-timing', label: 'Virtual Office Timing' },
  { id: 'holidays', label: 'Holidays' },
] as const;

type TabId = typeof TABS[number]['id'];

export default function CheckInsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-6 py-6">
        <div className="mb-6">
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Daily Check-Ins</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            Attendance overview, history, checklists, deadlines, virtual office timing, and holidays — all in one place.
          </p>
        </div>

        <div className="mb-5 flex gap-1 overflow-x-auto rounded-lg bg-canvas p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
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
    </div>
  );
}
