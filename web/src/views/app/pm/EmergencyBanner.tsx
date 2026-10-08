import { useEffect, useRef, useState } from 'react';
import { useEmergencyTasks } from '../../../hooks/useTasks';
import { usePMStore } from '../../../stores/pmStore';

// Emergency card shown above the pane: the first emergency task gets a proper
// call to action, the rest are listed underneath and in the "View all" menu.
export default function EmergencyBanner() {
  const { data: tasks } = useEmergencyTasks();
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  if (!tasks || tasks.length === 0) return null;

  const [lead, ...rest] = tasks;

  return (
    <div className="emg-card" role="alert" aria-live="polite">
      <span className="emg-card-icon" aria-hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      </span>
      <div className="emg-card-body">
        <div className="emg-card-eyebrow">
          Emergency · {tasks.length} active task{tasks.length === 1 ? '' : 's'}
        </div>
        <button type="button" className="emg-card-title" onClick={() => setActiveTask(lead.id)} title={lead.title}>
          {lead.title}
        </button>
        {rest.length > 0 && (
          <div className="emg-card-rest">
            Also{' '}
            {rest.map((t, i) => (
              <span key={t.id}>
                <button type="button" className="emg-card-rest-link" onClick={() => setActiveTask(t.id)} title={t.title}>
                  {t.title}
                </button>
                {i < rest.length - 1 ? <span aria-hidden> · </span> : null}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="emg-card-actions">
        {tasks.length > 1 && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              className="emg-card-btn emg-card-btn--ghost"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              View all {tasks.length}
            </button>
            {menuOpen && (
              <div className="emg-card-menu" role="menu">
                {tasks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="menuitem"
                    className="emg-card-menu-item"
                    onClick={() => { setActiveTask(t.id); setMenuOpen(false); }}
                    title={t.title}
                  >
                    <span className="emg-card-menu-dot" aria-hidden />
                    <span className="truncate">{t.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button type="button" className="emg-card-btn emg-card-btn--solid" onClick={() => setActiveTask(lead.id)}>
          Open task
        </button>
      </div>
    </div>
  );
}
