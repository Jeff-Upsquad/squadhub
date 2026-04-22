import { useState } from 'react';
import api from '../../../services/api';
import { getSocket } from '../../../services/socket';
import MentionPicker from '../../../components/MentionPicker';

// ---- Formatting toolbar button (28x28, padding 5px, icon 18x18) ----
function FormatBtn({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <button
      type="button"
      className="flex h-[28px] w-[28px] items-center justify-center rounded-[4px] text-foreground-dim transition hover:bg-sidebar-hover"
      title={title}
    >
      {children}
    </button>
  );
}

// ---- Toolbar divider (9px wide, 24px tall, 1px x 20px inner line) ----
function ToolbarDivider() {
  return (
    <div className="flex items-start px-[4px] py-[2px]">
      <div className="h-[20px] w-px bg-divider" />
    </div>
  );
}

// ---- Bottom bar button (28x28, padding 5px, icon 18x18) ----
function ActionBtn({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <button
      type="button"
      className="flex h-[28px] w-[28px] items-center justify-center rounded-[4px] text-foreground-muted transition hover:bg-sidebar-hover"
      title={title}
    >
      {children}
    </button>
  );
}

export default function MessageComposer({ channelId, onSend }: { channelId: string; onSend: () => void }) {
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await api.post('/messages', {
        channel_id: channelId,
        content: text.trim(),
        type: 'text',
        mentions,
      });
      setText('');
      setMentions([]);
      onSend();
    } catch (err) {
      console.error('Send message failed:', err);
    } finally {
      setSending(false);
    }
  };

  const handleTyping = () => {
    const socket = getSocket();
    if (socket) socket.emit('typing', { channel_id: channelId });
  };

  const hasText = text.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col items-start px-[20px] pb-[20px]">
      {/* Message Box container */}
      <div className="flex w-full flex-col items-start rounded-[8px] border border-divider bg-surface">

        {/* Formatting toolbar */}
        <div className="flex w-full flex-col items-start rounded-t-[8px] bg-surface-alt p-[4px]">
          <div className="flex items-center justify-center gap-[4px] py-px">
            {/* Bold */}
            <FormatBtn title="Bold">
              <svg className="h-[18px] w-[18px]" viewBox="0 0 18 18" fill="currentColor"><path d="M3.6 2.4h6a3 3 0 013 3 3 3 0 01-3 3H3.6V2.4zm0 6h6.75a3 3 0 013 3 3 3 0 01-3 3H3.6v-6zm1.5-4.5v3h4.5a1.5 1.5 0 000-3H5.1zm0 6v3h5.25a1.5 1.5 0 000-3H5.1z"/></svg>
            </FormatBtn>
            {/* Italic */}
            <FormatBtn title="Italic">
              <svg className="h-[18px] w-[18px]" viewBox="0 0 18 18" fill="currentColor"><path d="M7.5 3v1.5h1.66l-2.57 9H4.5V15h6v-1.5H8.84l2.57-9h2.09V3z"/></svg>
            </FormatBtn>
            {/* Strikethrough */}
            <FormatBtn title="Strikethrough">
              <svg className="h-[18px] w-[18px]" viewBox="0 0 18 18" fill="currentColor"><path d="M2.25 9h13.5v1.5H2.25V9zM6 3.75h6v1.5H6V3.75zM7.5 13.5h3V12h-3v1.5z"/></svg>
            </FormatBtn>

            <ToolbarDivider />

            {/* Link */}
            <FormatBtn title="Link">
              <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" /></svg>
            </FormatBtn>

            <ToolbarDivider />

            {/* Ordered list */}
            <FormatBtn title="Ordered list">
              <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="currentColor"><path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z"/></svg>
            </FormatBtn>
            {/* Bulleted list */}
            <FormatBtn title="Bulleted list">
              <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="currentColor"><path d="M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z"/></svg>
            </FormatBtn>

            <ToolbarDivider />

            {/* Code */}
            <FormatBtn title="Code">
              <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg>
            </FormatBtn>
            {/* Code block */}
            <FormatBtn title="Code block">
              <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" /></svg>
            </FormatBtn>
          </div>
        </div>

        {/* Message Text Box */}
        <div className="flex w-full items-start px-[12px] py-[8px]">
          <MentionPicker
            value={text}
            mentions={mentions}
            onChange={(t, m) => { setText(t); setMentions(m); handleTyping(); }}
            onSubmit={() => handleSubmit()}
            placeholder="Message"
          />
        </div>

        {/* Bottom action bar */}
        <div className="flex w-full items-center justify-between rounded-b-[8px] pb-[2px] pl-[6px] pr-[4px]">
          {/* Left side */}
          <div className="flex items-center gap-[2px]">
            {/* Plus button */}
            <button type="button" className="flex h-[24px] w-[24px] items-center justify-center rounded-full bg-foreground/[0.06] text-foreground-muted transition hover:bg-foreground/10" title="Attach">
              <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14m7-7H5" /></svg>
            </button>

            {/* Action buttons group */}
            <div className="flex items-center gap-[4px] py-[2px]">
              {/* Formatting (Aa with underline) */}
              <ActionBtn title="Formatting">
                <div className="flex flex-col items-center justify-center">
                  <svg className="h-[18px] w-[18px] -mb-px" viewBox="0 0 18 18" fill="currentColor"><path d="M4.5 13.5h1.5l.9-2.4h4.2l.9 2.4H13.5L9.75 3.75h-1.5L4.5 13.5zM7.35 9.9L9 5.4l1.65 4.5H7.35z"/></svg>
                  <div className="h-px w-[18px] rounded-[1px] bg-current" />
                </div>
              </ActionBtn>
              {/* Emoji */}
              <ActionBtn title="Emoji">
                <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z" /></svg>
              </ActionBtn>
              {/* @mention */}
              <ActionBtn title="Mention someone">
                <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M16.5 12a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zm0 0c0 1.657 1.007 3 2.25 3S21 13.657 21 12a9 9 0 10-2.636 6.364M16.5 12V8.25" /></svg>
              </ActionBtn>

              <ToolbarDivider />

              {/* Video clip */}
              <ActionBtn title="Record video">
                <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="m15.75 10.5 4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>
              </ActionBtn>
              {/* Audio clip */}
              <ActionBtn title="Record audio">
                <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>
              </ActionBtn>

              <ToolbarDivider />

              {/* Shortcut */}
              <ActionBtn title="Shortcuts">
                <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6z" /></svg>
              </ActionBtn>
            </div>
          </div>

          {/* Right side: Send button */}
          <div className="flex flex-col items-start py-[4px] pl-[4px] pr-[2px]">
            <div className="relative flex h-[28px] w-[55px] items-center rounded-[4px]">
              <button
                type="submit"
                disabled={!hasText || sending}
                className={`flex h-[28px] items-start rounded-l-[4px] px-[8px] py-[2px] transition ${hasText ? 'bg-[#007A5A] hover:bg-[#148567]' : ''}`}
              >
                <div className="flex items-start py-[4px]">
                  <svg className="h-[16px] w-[16px]" viewBox="0 0 24 24" fill="none" stroke={hasText ? 'white' : 'currentColor'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                </div>
              </button>

              <div className="absolute left-[32px] top-0 flex h-[28px] w-0 items-center justify-center">
                <div className={`h-[20px] w-px ${hasText ? 'bg-white/20' : 'bg-foreground/[0.06]'}`} />
              </div>

              <button
                type="button"
                disabled={!hasText || sending}
                className={`absolute left-[32px] flex h-[28px] items-start rounded-r-[4px] px-[4px] py-[2px] transition ${hasText ? 'bg-[#007A5A] hover:bg-[#148567]' : ''}`}
              >
                <div className="flex h-[24px] items-center justify-center">
                  <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" fill="none" stroke={hasText ? 'white' : 'currentColor'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
