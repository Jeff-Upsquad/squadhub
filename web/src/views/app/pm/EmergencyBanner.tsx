import { useEmergencyTasks } from '../../../hooks/useTasks';
import { usePMStore } from '../../../stores/pmStore';

export default function EmergencyBanner() {
  const { data: tasks } = useEmergencyTasks();
  const setActiveTask = usePMStore((s) => s.setActiveTask);

  if (!tasks || tasks.length === 0) return null;

  const preview = tasks.slice(0, 3);
  const extra = tasks.length - preview.length;

  return (
    <div className="emg-banner" role="alert" aria-live="polite">
      <span className="emg-banner-label">Emergency</span>
      <span>
        {tasks.length} active task{tasks.length === 1 ? '' : 's'}:
      </span>
      {preview.map((t, i) => (
        <span key={t.id} className="inline-flex items-center gap-1">
          <button
            type="button"
            className="emg-banner-link"
            onClick={() => setActiveTask(t.id)}
            title={t.title}
          >
            {t.title}
          </button>
          {i < preview.length - 1 || extra > 0 ? <span aria-hidden>·</span> : null}
        </span>
      ))}
      {extra > 0 && <span>+{extra} more</span>}
    </div>
  );
}
