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
        <h2 className="text-xs font-medium uppercase tracking-wider text-[#888]">Channels</h2>
        <button
          onClick={onCreateChannel}
          className="text-[#555] transition hover:text-[#ededed]"
          title="Create channel"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2">
        {channels.map((ch) => (
          <button
            key={ch.id}
            onClick={() => onSelect(ch.id)}
            className={`mb-0.5 flex w-full items-center rounded-md px-3 py-1.5 text-left text-sm transition ${
              activeId === ch.id
                ? 'bg-[#1a1a1a] text-[#ededed]'
                : 'text-[#888] hover:bg-[#111] hover:text-[#ededed]'
            }`}
          >
            <span className="mr-2 text-[#555]">#</span>
            {ch.name}
          </button>
        ))}
      </div>
    </div>
  );
}
