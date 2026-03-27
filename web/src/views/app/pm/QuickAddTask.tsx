import { useState } from 'react';
import { useCreateTask } from '../../../hooks/useTasks';

export default function QuickAddTask({
  listId,
  status,
}: {
  listId: string;
  status: string;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const createTask = useCreateTask(listId);

  const handleSubmit = () => {
    if (!title.trim()) { setAdding(false); return; }
    createTask.mutate(
      { title: title.trim(), status },
      { onSuccess: () => { setTitle(''); } },
    );
  };

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="flex w-full items-center gap-2 px-4 py-1.5 text-xs text-[#999999] transition hover:text-[#0F172B]"
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
        className="w-full rounded border border-[#CAD5E2] bg-[#F8FAFC] px-2.5 py-1.5 text-sm text-[#0F172B] placeholder-[#999999] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
      />
    </div>
  );
}
