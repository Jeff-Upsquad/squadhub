export type ActiveSection = 'home' | 'docs' | 'calendar' | 'apps' | 'teams';
export type HomeTab = 'chat' | 'tasks';

export default function ModuleSwitcher({ active, onChange }: {
  active: HomeTab;
  onChange: (tab: HomeTab) => void;
}) {
  return (
    <div className="flex border-b border-[#eaeaea] bg-white">
      <button
        onClick={() => onChange('chat')}
        className={`flex-1 px-4 py-2.5 font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] transition ${
          active === 'chat'
            ? 'border-b-2 border-[#0070F3] text-[#171717]'
            : 'text-[#999] hover:text-[#666]'
        }`}
      >
        Chat
      </button>
      <button
        onClick={() => onChange('tasks')}
        className={`flex-1 px-4 py-2.5 font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] transition ${
          active === 'tasks'
            ? 'border-b-2 border-[#0070F3] text-[#171717]'
            : 'text-[#999] hover:text-[#666]'
        }`}
      >
        Tasks
      </button>
    </div>
  );
}
