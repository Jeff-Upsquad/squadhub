'use client';

import { useState } from 'react';
import type { SpaceStatus } from '@squadhub/shared';
import TaskRelationshipsModal from './TaskRelationshipsModal';

export default function TaskRelationshipsButton({
  task,
  canEdit = true,
  className = '',
}: {
  task: {
    id: string;
    title: string;
    status?: SpaceStatus | string | null;
    metadata?: Record<string, any> | null;
  };
  canEdit?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const relationships: any[] = Array.isArray(task.metadata?.relationships)
    ? task.metadata.relationships
    : [];
  const count = relationships.length;
  const hasRelationships = count > 0;

  return (
    <>
      <button
        type="button"
        className={`lv-relation-btn ${className}`}
        data-active={hasRelationships || open || undefined}
        aria-label="Task relationships"
        title={hasRelationships ? `Relationships (${count} connected)` : 'Relationships'}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      </button>

      {open && (
        <TaskRelationshipsModal
          taskId={task.id}
          taskTitle={task.title}
          currentStatus={task.status}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
