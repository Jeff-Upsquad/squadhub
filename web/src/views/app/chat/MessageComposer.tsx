import { useRef, useState } from 'react';
import api from '../../../services/api';
import { getSocket } from '../../../services/socket';
import MentionPicker from '../../../components/MentionPicker';
import { useUploadAttachment } from '../../../hooks/useUploadAttachment';
import type { ChatKind } from '../../../stores/workspaceStore';
import EmojiPicker from './EmojiPicker';
import VoiceRecorder from './VoiceRecorder';

// ---- Toolbar divider ----
function Divider() {
  return <span className="mx-[2px] h-[20px] w-px bg-divider" />;
}

// ---- Bottom-bar icon button (28x28, padding 5px, icon 18x18) ----
function IconBtn({
  children,
  title,
  onClick,
  active,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-[28px] w-[28px] items-center justify-center rounded-[6px] transition ${
        active ? 'bg-surface-alt text-foreground' : 'text-foreground-muted hover:bg-surface-alt hover:text-foreground'
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

interface Props {
  channelId: string;
  kind?: ChatKind;
  parentMessageId?: string;
  placeholder?: string;
  onSend: () => void;
}

export default function MessageComposer({
  channelId,
  kind = 'channel',
  parentMessageId,
  placeholder,
  onSend,
}: Props) {
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [recording, setRecording] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { upload, uploading, progress } = useUploadAttachment(kind, channelId);

  const idField = kind === 'dm' ? 'dm_conversation_id' : 'channel_id';

  const postMessage = async (extra: Record<string, unknown> = {}) => {
    await api.post('/messages', {
      [idField]: channelId,
      content: text.trim() || null,
      type: extra.type || 'text',
      mentions,
      parent_message_id: parentMessageId,
      ...extra,
    });
    setText('');
    setMentions([]);
    onSend();
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (sending) return;

    if (pendingFile) {
      setSending(true);
      setSendError(null);
      try {
        const result = await upload(pendingFile);
        if (!result) throw new Error('Upload failed');
        const apiType = result.category === 'file' ? 'file' : result.category;
        await postMessage({
          type: apiType,
          file_url: result.file_url,
          file_name: result.file_name,
          file_size: result.file_size,
          file_mime: result.file_mime,
        });
        setPendingFile(null);
      } catch (err: unknown) {
        const message =
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          (err as Error)?.message ||
          'Could not send the file.';
        console.error('File send failed:', err);
        setSendError(message);
      } finally {
        setSending(false);
      }
      return;
    }

    if (!text.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      await postMessage();
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (err as Error)?.message ||
        'Could not send message.';
      console.error('Send message failed:', err);
      setSendError(message);
    } finally {
      setSending(false);
    }
  };

  const handleTyping = () => {
    const socket = getSocket();
    if (socket) socket.emit('typing', { [idField]: channelId });
  };

  const handlePickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setPendingFile(f);
    e.target.value = '';
  };

  const handleVoiceComplete = async (blob: Blob, durationMs: number) => {
    setRecording(false);
    setSending(true);
    setSendError(null);
    try {
      const filename = `voice-${Date.now()}.webm`;
      const result = await upload(blob, filename, blob.type || 'audio/webm');
      if (!result) throw new Error('Upload failed');
      await postMessage({
        type: 'audio',
        file_url: result.file_url,
        file_name: result.file_name,
        file_size: result.file_size,
        file_mime: result.file_mime,
        duration_ms: durationMs,
      });
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (err as Error)?.message ||
        'Could not send the voice note.';
      console.error('Voice note failed:', err);
      setSendError(message);
    } finally {
      setSending(false);
    }
  };

  const insertEmoji = (emoji: string) => setText((t) => t + emoji);

  // Safety-net Enter handler at the form level. MentionPicker also catches
  // Enter via its own keydown to call onSubmit, but if the picker's input
  // doesn't have focus or its handler is stale, this ensures Enter still
  // submits. e.defaultPrevented guards against double-submission when
  // MentionPicker did handle it.
  const handleFormKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') return;
    e.preventDefault();
    handleSubmit();
  };

  const hasText = text.trim().length > 0;
  const hasPending = !!pendingFile;
  const canSend = (hasText || hasPending) && !sending && !uploading;

  const effectivePlaceholder =
    placeholder ||
    (parentMessageId
      ? 'Reply…'
      : kind === 'dm'
        ? 'Message…'
        : "Write a message, press 'space' for AI, '/' for commands");

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={handleFormKeyDown}
      className="flex flex-col items-start px-[20px] pb-[20px]"
    >
      {/* Send error banner */}
      {sendError && (
        <div className="mb-2 flex w-full items-center justify-between rounded-[6px] border border-[#E11D48] bg-[#FFF1F2] px-3 py-2 text-[12px] text-[#9F1239]">
          <span className="truncate">{sendError}</span>
          <button
            type="button"
            onClick={() => setSendError(null)}
            className="ml-2 text-[#9F1239] hover:text-[#7F1D1D]"
            aria-label="Dismiss"
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Pending attachment chip */}
      {pendingFile && (
        <div className="mb-2 flex w-full items-center gap-2 rounded-[6px] border border-divider bg-surface-alt px-3 py-2 text-[13px]">
          <svg className="h-4 w-4 text-foreground-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <span className="flex-1 truncate text-foreground">{pendingFile.name}</span>
          <span className="text-foreground-muted">{(pendingFile.size / 1024 / 1024).toFixed(1)} MB</span>
          {uploading && <span className="text-[#1264A3]">{progress}%</span>}
          <button
            type="button"
            onClick={() => setPendingFile(null)}
            className="text-foreground-muted hover:text-foreground"
            disabled={uploading}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Composer box */}
      <div className="flex w-full flex-col items-stretch rounded-[10px] border border-divider bg-surface">
        {recording ? (
          <div className="p-2">
            <VoiceRecorder onCancel={() => setRecording(false)} onComplete={handleVoiceComplete} />
          </div>
        ) : (
          <>
            {/* Single text row */}
            <div className="flex w-full items-start px-[14px] pt-[10px] pb-[6px]">
              <MentionPicker
                value={text}
                mentions={mentions}
                onChange={(t, m) => { setText(t); setMentions(m); handleTyping(); }}
                onSubmit={() => handleSubmit()}
                placeholder={effectivePlaceholder}
              />
            </div>

            {/* Bottom action bar */}
            <div className="flex w-full items-center justify-between px-[6px] pb-[6px]">
              {/* Left scroll group — fits Slack-like icon set */}
              <div className="flex min-w-0 flex-1 items-center gap-[2px] overflow-x-auto">
                {/* Plus (round, bordered) */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-full border border-divider text-foreground-muted transition hover:bg-surface-alt hover:text-foreground disabled:opacity-40"
                  title="Attach file"
                >
                  <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14m7-7H5" />
                  </svg>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handlePickFile}
                  accept="image/*,audio/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                />

                <Divider />

                {/* Paperclip (attach – alt entry) */}
                <IconBtn title="Attach" onClick={() => fileInputRef.current?.click()}>
                  <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.122 2.122l7.81-7.81" />
                  </svg>
                </IconBtn>

                {/* Emoji */}
                <div className="relative">
                  <IconBtn title="Emoji" onClick={() => setShowEmoji((v) => !v)} active={showEmoji}>
                    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75z" />
                    </svg>
                  </IconBtn>
                  {showEmoji && (
                    <div className="absolute bottom-[36px] left-0">
                      <EmojiPicker onPick={insertEmoji} onClose={() => setShowEmoji(false)} />
                    </div>
                  )}
                </div>

                {/* Audio / voice */}
                <IconBtn title="Record voice note" onClick={() => setRecording(true)}>
                  <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                  </svg>
                </IconBtn>
              </div>

              {/* Right side: split Send button */}
              <div className="ml-2 flex items-center">
                <button
                  type="submit"
                  disabled={!canSend}
                  title={hasPending ? 'Send file' : 'Send'}
                  className={`flex h-[28px] items-center justify-center rounded-l-[6px] px-[10px] transition ${
                    canSend ? 'bg-[#007A5A] text-white hover:bg-[#148567]' : 'border border-divider border-r-0 text-foreground-muted'
                  }`}
                >
                  {sending || uploading ? (
                    <span className="text-[11px] font-medium">{uploading ? `${progress}%` : '…'}</span>
                  ) : (
                    <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  disabled={!canSend}
                  title="Send options"
                  className={`flex h-[28px] items-center justify-center rounded-r-[6px] px-[6px] transition ${
                    canSend ? 'bg-[#007A5A] text-white hover:bg-[#148567] border-l border-white/20' : 'border border-divider text-foreground-muted'
                  }`}
                >
                  <svg className="h-[13px] w-[13px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </form>
  );
}
