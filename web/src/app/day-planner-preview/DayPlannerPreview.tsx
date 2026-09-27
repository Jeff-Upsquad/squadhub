'use client';

import { useEffect, useState } from 'react';
import { installPreviewApi } from './mockApi';
import DayPlannerView from '../../views/app/DayPlannerView';
import GlobalTaskDetailPanel from '../../views/app/home/GlobalTaskDetailPanel';

// Front-end-only preview: swaps the API client for an in-memory adapter,
// then mounts the production DayPlannerView full-screen plus the global
// task panel.
export default function DayPlannerPreview() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    installPreviewApi();
    setReady(true);
  }, []);
  if (!ready) return null;
  return (
    <div style={{ height: '100vh', background: 'var(--surface)' }}>
      <DayPlannerView />
      {/* Same slide-over the app shell mounts, so clicking a task opens it. */}
      <GlobalTaskDetailPanel />
    </div>
  );
}
