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
        <h2 className="font-[family-name:var(--font-mono)] text-xs font-medium uppercase tracking-[0.12em] text-[#666666]">Channels</h2>
        <button
          onClick={onCreateChannel}
          className="text-[#999999] transition hover:text-[#171717]"
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
                ? 'bg-[#f5f5f5] text-[#171717]'
                : 'text-[#666666] hover:bg-[#fafafa] hover:text-[#171717]'
            }`}
          >
            <span className="mr-2 text-[#999999]">#</span>
            {ch.name}
          </button>
        ))}
      </div>
    </div>
  );
}
