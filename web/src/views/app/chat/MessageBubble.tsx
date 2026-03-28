import type { Message } from '@squadhub/shared';

// ---- Mention rendering ----
function renderContent(text: string) {
  const parts = text.split(/(@\w+)/g);
  return parts.map((part, i) =>
    part.startsWith('@') ? (
      <span key={i} className="inline-flex items-center justify-center rounded-[2px] bg-[rgba(18,100,163,0.1)] px-1 py-[2px] font-[Lato] text-[15px] leading-[22px] text-[#1264A3]">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

// ---- Date separator ----
export function DateSeparator({ date }: { date: string }) {
  return (
    <div className="relative h-[32px] w-full">
      {/* Horizontal line at y=15px */}
      <div className="absolute left-0 top-[15px] h-px w-full bg-[#DDDDDD]" />
      {/* Centered pill */}
      <button className="absolute left-1/2 top-0 -translate-x-1/2 flex items-center justify-center gap-1 rounded-[100px] border border-[#DDDDDD] bg-white px-4 py-2 dark:border-divider dark:bg-surface">
        <span className="font-[Lato] text-[12px] font-bold leading-[16px] text-[#1D1C1D] whitespace-nowrap">
          {date}
        </span>
        {/* Chevron arrow (4.56x8 rotated 90deg = dropdown) */}
        <svg className="h-[12.56px] w-[14px]" viewBox="0 0 14 12.56" fill="none">
          <path d="M5 2L9.56 6.28L5 10.56" stroke="#1D1C1D" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" transform="rotate(90 7 6.28)" />
        </svg>
      </button>
    </div>
  );
}

// ---- Reaction badge (Component 1 - personal variant) ----
function ReactionBadge({ emoji, count }: { emoji: string; count: number }) {
  return (
    <button className="box-border flex items-center gap-[6px] rounded-[100px] border-[0.5px] border-[#1264A3] bg-[rgba(18,100,163,0.1)] px-[6px] py-[4px] hover:bg-[rgba(18,100,163,0.15)] transition">
      <span className="h-4 w-4 text-[16px] leading-[16px]">{emoji}</span>
      <span className="font-[Lato] text-[12px] font-normal leading-[16px] text-[#1D1C1D]">{count}</span>
    </button>
  );
}

// ---- Add reaction button (Component 1 - icon variant) ----
function AddReactionButton() {
  return (
    <button className="flex items-start rounded-[100px] bg-[#F8F8F8] px-[10px] py-[4px] hover:bg-[#ebebeb] transition dark:bg-surface-alt">
      <svg className="h-4 w-[15.5px]" viewBox="0 0 15.5 16" fill="none">
        <circle cx="7.75" cy="8" r="7" stroke="#616061" strokeWidth="1.2" />
        <circle cx="5.5" cy="6.5" r="0.8" fill="#616061" />
        <circle cx="10" cy="6.5" r="0.8" fill="#616061" />
        <path d="M5 10c.8 1.2 2.2 2 3.75 2s2.95-.8 3.75-2" stroke="#616061" strokeWidth="1.1" strokeLinecap="round" fill="none" />
      </svg>
    </button>
  );
}

// ---- Thread reply bar (Frame 39) ----
function ThreadReplyBar({ replyCount }: { replyCount: number }) {
  return (
    <button className="flex w-full items-center justify-between rounded-[4px] border border-[#DDDDDD] bg-white px-[6px] py-[4px] hover:bg-gray-50 transition dark:border-divider dark:bg-surface">
      <div className="flex items-center gap-[7px]">
        {/* Stacked avatars */}
        <div className="flex items-start gap-[4px]">
          <div className="flex h-6 w-6 items-center justify-center rounded-[4px] bg-[#E2E8F0] text-[10px] font-bold text-[#0F172B] overflow-hidden">A</div>
          <div className="flex h-6 w-6 items-center justify-center rounded-[4px] bg-[#FECACA] text-[10px] font-bold text-[#0F172B] overflow-hidden">B</div>
        </div>
        <span className="font-[Lato] text-[12px] font-normal leading-[16px] text-[#1364A3]">{replyCount} replies</span>
        <span className="font-[Lato] text-[12px] font-normal leading-[16px] text-[#616061]">View thread</span>
      </div>
      {/* Right arrow (rotated 90deg from forward arrow) */}
      <svg className="h-[12.56px] w-[12px]" viewBox="0 0 12 12.56" fill="none">
        <path d="M4 2L8.56 6.28L4 10.56" stroke="#1D1C1D" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

// ---- Hover action bar ----
function HoverActions() {
  return (
    <div className="absolute -top-3 right-4 hidden rounded-md border border-divider bg-surface shadow-sm group-hover:flex">
      <button className="p-1.5 text-foreground-dim hover:bg-surface-alt hover:text-foreground transition">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z" />
        </svg>
      </button>
      <button className="p-1.5 text-foreground-dim hover:bg-surface-alt hover:text-foreground transition">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
        </svg>
      </button>
      <button className="p-1.5 text-foreground-dim hover:bg-surface-alt hover:text-foreground transition">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
        </svg>
      </button>
      <button className="p-1.5 text-foreground-dim hover:bg-surface-alt hover:text-foreground transition">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
        </svg>
      </button>
    </div>
  );
}

// ---- Main component ----
export default function MessageBubble({ message }: { message: Message }) {
  const sender = message.sender;
  const time = new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const hasMention = message.content?.includes('@');

  return (
    <div className="group relative flex gap-[6px] px-[20px] py-[10px] hover:bg-[#f8f8f8] dark:hover:bg-white/[0.02]">
      <HoverActions />
      {/* Avatar wrapper: padding 3px 0px */}
      <div className="flex items-center py-[3px]">
        <div className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[6px] bg-[#E2E8F0] text-sm font-bold text-[#0F172B] overflow-hidden">
          {sender?.display_name?.[0]?.toUpperCase() || '?'}
        </div>
      </div>
      {/* Content column: gap 4px */}
      <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
        {/* Header row with name + time */}
        <div className="flex flex-col pr-[20px]">
          <div className="flex items-center gap-[10px]">
            <span className="font-[Lato] text-[15px] font-black leading-[22px] text-[#1D1C1D]">
              {sender?.display_name || 'Unknown'}
            </span>
            <span className="font-[Lato] text-[12px] font-normal leading-[16px] text-[#616061]">
              {time}
            </span>
          </div>
          {/* Message content row */}
          <div className="flex items-center gap-[10px] w-full">
            {hasMention && message.content && (
              <span className="shrink-0 inline-flex items-center justify-center rounded-[2px] bg-[rgba(18,100,163,0.1)] px-1 py-[2px] font-[Lato] text-[15px] leading-[22px] text-[#1264A3]">
                @channel
              </span>
            )}
            {message.content && (
              <p className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-[Lato] text-[15px] font-normal leading-[22px] text-[#1D1C1D]">
                {hasMention ? message.content.replace(/@\w+\s*/g, '') : message.content}
              </p>
            )}
          </div>
        </div>
        {message.file_url && message.type === 'image' && (
          <img src={message.file_url} alt="attachment" className="mt-1 max-h-60 rounded-lg" />
        )}
        {message.file_url && message.type === 'audio' && (
          <audio controls src={message.file_url} className="mt-1" />
        )}
        {/* Reactions row: gap 4px */}
        <div className="flex items-center gap-[4px]">
          <ReactionBadge emoji="❤️" count={1} />
          <AddReactionButton />
        </div>
        {/* Thread replies */}
        <ThreadReplyBar replyCount={4} />
      </div>
    </div>
  );
}
