import type { ReactNode } from 'react';
import { useEmergencyTasks } from '../../../hooks/useTasks';
import { usePMStore } from '../../../stores/pmStore';
import { LiveDot } from '../../../components/ActiveTimer';

// Top-banner strip under the tab bar: every emergency task as its own short red
// tile ("Emergency 1 of 3" …), followed by whatever `after` brings (the running
// timer tiles on Home). Collapses via :empty when there's nothing to show.
export default function EmergencyBanner({ after }: { after?: ReactNode }) {
  const { data: tasks } = useEmergencyTasks();
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const emg = tasks ?? [];

  return (
    <div className="tbn empty:hidden" role="region" aria-label="Emergencies and running timers">
      {emg.map((t, i) => (
        <button
          key={t.id}
          type="button"
          className="tbn-tile"
          data-kind="emergency"
          onClick={() => setActiveTask(t.id)}
          title={t.title}
        >
          <LiveDot tone="emergency" />
          <span className="tbn-text">
            <span className="tbn-label">{emg.length > 1 ? `Emergency ${i + 1} of ${emg.length}` : 'Emergency'}</span>
            <span className="tbn-title">{t.title}</span>
          </span>
        </button>
      ))}
      {after}
    </div>
  );
}
