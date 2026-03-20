import type { Message } from '@squadhub/shared';

export default function MessageBubble({ message }: { message: Message }) {
  const sender = message.sender;
  const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="group flex gap-3 px-5 py-1.5 hover:bg-[#F1F5F9]/50">
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#E2E8F0] text-sm font-medium text-[#0F172B]">
        {sender?.display_name?.[0]?.toUpperCase() || '?'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-[#0F172B]">{sender?.display_name || 'Unknown'}</span>
          <span className="font-[family-name:var(--font-mono)] text-[10px] text-[#999999]">{time}</span>
        </div>
        {message.content && <p className="text-sm text-[#666666]">{message.content}</p>}
        {message.file_url && message.type === 'image' && (
          <img src={message.file_url} alt="attachment" className="mt-1 max-h-60 rounded-lg" />
        )}
        {message.file_url && message.type === 'audio' && (
          <audio controls src={message.file_url} className="mt-1" />
        )}
      </div>
    </div>
  );
}
