export type ActiveModule = 'chat' | 'tasks';

export default function ModuleSwitcher({ active, onChange }: {
  active: ActiveModule;
  onChange: (module: ActiveModule) => void;
}) {
  return (
    <div className="flex border-b border-gray-800 bg-[var(--color-sidebar)]">
      <button
        onClick={() => onChange('chat')}
        className={`flex-1 px-4 py-2.5 text-sm font-medium transition ${
          active === 'chat'
            ? 'border-b-2 border-brand-500 text-white'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        Chat
      </button>
      <button
        onClick={() => onChange('tasks')}
        className={`flex-1 px-4 py-2.5 text-sm font-medium transition ${
          active === 'tasks'
            ? 'border-b-2 border-brand-500 text-white'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        Tasks
      </button>
    </div>
  );
}
