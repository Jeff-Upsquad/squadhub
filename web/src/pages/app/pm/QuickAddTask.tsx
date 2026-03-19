import { useState } from 'react';
import { useCreateTask } from '../../../hooks/useTasks';

export default function QuickAddTask({
  listId,
  statusId,
}: {
  listId: string;
  statusId: string;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const createTask = useCreateTask(listId);

  const handleSubmit = () => {
    if (!title.trim()) { setAdding(false); return; }
    createTask.mutate(
      { title: title.trim(), status_id: statusId },
      { onSuccess: () => { setTitle(''); } },
    );
  };

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="flex w-full items-center gap-2 px-4 py-1.5 text-xs text-[#555] transition hover:text-[#ededed]"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add task
      </button>
    );
  }

  return (
    <div className="px-4 py-1.5">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
          if (e.key === 'Escape') { setAdding(false); setTitle(''); }
        }}
        onBlur={handleSubmit}
        placeholder="Task name..."
        className="w-full rounded border border-[#333] bg-[#1a1a1a] px-2.5 py-1.5 text-sm text-[#ededed] placeholder-[#555] outline-none focus:border-[#ededed]"
      />
    </div>
  );
}
