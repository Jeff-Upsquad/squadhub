import { usePMStore } from '../../../stores/pmStore';
import { toggleGroupSelection } from '../../../lib/bulkTasks';

export default function GroupTaskSelection({ ids }: { ids: string[] }) {
  const selected = usePMStore((s) => s.selectedTasks);
  const all = ids.length > 0 && ids.every((id) => selected.includes(id));
  if (!ids.length) return null;
  return <button type="button" className="group-task-select" data-selected={all || undefined}
    aria-pressed={all} onClick={(e) => {
      e.stopPropagation();
      const state = usePMStore.getState();
      state.selectAllTasks(toggleGroupSelection(state.selectedTasks, ids));
    }}>{all ? 'Deselect all tasks' : 'Select all tasks'}</button>;
}
