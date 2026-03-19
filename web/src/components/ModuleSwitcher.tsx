export type ActiveSection = 'home' | 'docs' | 'calendar' | 'apps' | 'teams';
export type HomeTab = 'chat' | 'tasks';

export default function ModuleSwitcher({ active, onChange }: {
  active: HomeTab;
  onChange: (tab: HomeTab) => void;
}) {
  return (
    <div className="flex border-b border-[#222] bg-[#0a0a0a]">
      <button
        onClick={() => onChange('chat')}
        className={`flex-1 px-4 py-2.5 text-xs font-medium uppercase tracking-wider transition ${
          active === 'chat'
            ? 'border-b-2 border-[#ededed] text-[#ededed]'
            : 'text-[#555] hover:text-[#888]'
        }`}
      >
        Chat
      </button>
      <button
        onClick={() => onChange('tasks')}
        className={`flex-1 px-4 py-2.5 text-xs font-medium uppercase tracking-wider transition ${
          active === 'tasks'
            ? 'border-b-2 border-[#ededed] text-[#ededed]'
            : 'text-[#555] hover:text-[#888]'
        }`}
      >
        Tasks
      </button>
    </div>
  );
}
