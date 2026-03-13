import type { Channel } from '@squadhub/shared';

export default function ChannelSidebar({ channels, activeId, onSelect, onCreateChannel }: {
  channels: Channel[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreateChannel: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--color-sidebar-text-bright)]">Channels</h2>
        <button
          onClick={onCreateChannel}
          className="text-lg text-gray-400 hover:text-white"
          title="Create channel"
        >
          +
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2">
        {channels.map((ch) => (
          <button
            key={ch.id}
            onClick={() => onSelect(ch.id)}
            className={`mb-0.5 flex w-full items-center rounded-md px-3 py-1.5 text-left text-sm transition ${
              activeId === ch.id
                ? 'bg-[var(--color-sidebar-active)] text-white'
                : 'text-[var(--color-sidebar-text)] hover:bg-[var(--color-sidebar-hover)]'
            }`}
          >
            <span className="mr-2 text-gray-500">#</span>
            {ch.name}
          </button>
        ))}
      </div>
    </div>
  );
}
