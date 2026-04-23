import { useState } from 'react';
import type { Task } from '@squadhub/shared';
import DashboardTaskRow from '../home/DashboardTaskRow';

export default function CompletedSection({ tasks }: { tasks: Task[] }) {
  const [open, setOpen] = useState(false);
  if (tasks.length === 0) return null;

  return (
    <div className="today-group">
      <div
        className="today-group-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          style={{
            transition: 'transform 120ms ease',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Completed</span>
        <span className="count">· {tasks.length}</span>
      </div>
      {open && (
        <div className="today-list">
          {tasks.map((t) => (
            <DashboardTaskRow key={t.id} task={t} />
          ))}
        </div>
      )}
    </div>
  );
}
