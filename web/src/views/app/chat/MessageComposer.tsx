import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import api from '../../../services/api';
import { getSocket } from '../../../services/socket';
import { useUploadAttachment } from '../../../hooks/useUploadAttachment';
import type { ChatKind } from '../../../stores/workspaceStore';
import EmojiPicker from './EmojiPicker';
import VoiceRecorder from './VoiceRecorder';

// ---- Convert Tiptap HTML output → markdown (matches the renderer in MessageBubble) ----
function htmlToMarkdown(html: string): string {
  if (!html || html === '<p></p>') return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const inner = Array.from(el.childNodes).map(walk).join('');

    switch (tag) {
      case 'strong':
      case 'b':
        return `**${inner}**`;
      case 'em':
      case 'i':
        return `_${inner}_`;
      case 's':
      case 'del':
      case 'strike':
        return `~~${inner}~~`;
      case 'code': {
        // <code> inside <pre> is handled at the <pre> level; bare <code> = inline
        if (el.parentElement?.tagName.toLowerCase() === 'pre') return inner;
        return `\`${inner}\``;
      }
      case 'pre':
        return `\n\`\`\`\n${inner}\n\`\`\`\n`;
      case 'a': {
        const href = el.getAttribute('href') || '';
        return `[${inner}](${href})`;
      }
      case 'blockquote':
        return inner
          .split('\n')
          .map((l) => (l ? `> ${l}` : '>'))
          .join('\n') + '\n';
      case 'ul':
        return Array.from(el.children)
          .map((li) => `- ${walk(li).trim()}`)
          .join('\n') + '\n';
      case 'ol':
        return Array.from(el.children)
          .map((li, i) => `${i + 1}. ${walk(li).trim()}`)
          .join('\n') + '\n';
      case 'li':
        return inner;
      case 'p':
        return inner + '\n';
      case 'br':
        return '\n';
      case 'hr':
        return '\n---\n';
      default:
        return inner;
    }
  };

  return Array.from(doc.body.childNodes).map(walk).join('').replace(/\n{3,}/g, '\n\n').trim();
}

function ToolBtn({
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
      onMouseDown={(e) => e.preventDefault() /* keep editor focus */}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`sqc-composer__tool${active ? ' is-active' : ''}`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="sqc-tool-divider" />;
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
  const [sending, setSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [recording, setRecording] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [hasText, setHasText] = useState(false);
  // Slack shows the formatting bar by default; the Aa button toggles it.
  const [showFmt, setShowFmt] = useState(true);
  // Bumped on every send/state change to force toolbar buttons to re-render
  // with the latest editor.isActive(...) results.
  const [, setEditorTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerBoxRef = useRef<HTMLDivElement>(null);

  const { upload, uploading, progress } = useUploadAttachment(kind, channelId);
  const idField = kind === 'dm' ? 'dm_conversation_id' : 'channel_id';

  const effectivePlaceholder =
    placeholder ||
    (parentMessageId ? 'Reply…' : kind === 'dm' ? 'Message…' : 'Message #channel');

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // We render @mentions via the markdown renderer, so the editor doesn't
        // need a mention extension. Code block and other defaults are fine.
        heading: { levels: [1, 2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { class: 'sqc-link' },
      }),
      Placeholder.configure({ placeholder: effectivePlaceholder }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'sqc-composer__input',
        'aria-label': 'Message composer',
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          submitMessage();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      setHasText(!editor.isEmpty);
      setEditorTick((t) => t + 1);
      // Lightweight typing indicator
      const socket = getSocket();
      if (socket) socket.emit('typing', { [idField]: channelId });
    },
    onSelectionUpdate: () => setEditorTick((t) => t + 1),
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    // Recreate when the conversation (and so the placeholder) changes —
    // Placeholder is baked into the extension config at creation time.
  }, [effectivePlaceholder]);

  // Reset the editor when switching channels/DMs/threads
  useEffect(() => {
    editor?.commands.clearContent(true);
    setHasText(false);
  }, [channelId, parentMessageId, editor]);

  const postMessage = async (extra: Record<string, unknown> = {}) => {
    const md = editor ? htmlToMarkdown(editor.getHTML()) : '';
    await api.post('/messages', {
      [idField]: channelId,
      content: md || null,
      type: extra.type || 'text',
      parent_message_id: parentMessageId,
      ...extra,
    });
    editor?.commands.clearContent(true);
    setHasText(false);
    onSend();
  };

  const submitMessage = async () => {
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

    if (!hasText) return;
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

  const insertEmoji = (emoji: string) => editor?.chain().focus().insertContent(emoji).run();

  const setLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', prev || 'https://');
    if (url === null) return;
    if (!url) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const canSend = (hasText || !!pendingFile) && !sending && !uploading;
  const isActive = (name: string, opts?: Record<string, unknown>): boolean =>
    !!editor && editor.isActive(name, opts as never);

  const handleEditorBoxClick = (e: React.MouseEvent) => {
    // Click anywhere in the input area focuses the editor (Slack-like).
    if ((e.target as HTMLElement).closest('button')) return;
    editor?.chain().focus().run();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submitMessage();
      }}
      className="sqc-composer-wrap"
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
        <div className="mb-2 flex w-full items-center gap-2 rounded-[6px] border border-[var(--sh-border)] bg-[var(--sh-bg-soft)] px-3 py-2 text-[13px]">
          <svg className="h-4 w-4 text-[var(--sh-text-2)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <span className="flex-1 truncate text-[var(--sh-text)]">{pendingFile.name}</span>
          <span className="text-[var(--sh-text-2)]">{(pendingFile.size / 1024 / 1024).toFixed(1)} MB</span>
          {uploading && <span className="text-[var(--sh-link)]">{progress}%</span>}
          <button
            type="button"
            onClick={() => setPendingFile(null)}
            className="text-[var(--sh-text-2)] hover:text-[var(--sh-text)]"
            disabled={uploading}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div
        className="sqc-composer"
        ref={composerBoxRef}
        data-focused={focused || hasText ? 'true' : 'false'}
        data-fmt={showFmt ? 'on' : 'off'}
      >
        {recording ? (
          <div className="p-2">
            <VoiceRecorder onCancel={() => setRecording(false)} onComplete={handleVoiceComplete} />
          </div>
        ) : (
          <>
            {/* Formatting toolbar (WYSIWYG via Tiptap commands) */}
            <div className="sqc-composer__toolbar">
              <ToolBtn title="Bold (Cmd+B)" active={isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 4h7a4 4 0 010 8H6zM6 12h8a4 4 0 010 8H6z" />
                </svg>
              </ToolBtn>
              <ToolBtn title="Italic (Cmd+I)" active={isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M19 4h-9M14 20H5M15 4L9 20" />
                </svg>
              </ToolBtn>
              <ToolBtn title="Strikethrough" active={isActive('strike')} onClick={() => editor?.chain().focus().toggleStrike().run()}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 12h16M16 6a4 4 0 00-4-2c-3 0-4 2-4 3 0 2 2 3 4 3M8 18a4 4 0 004 2c3 0 4-2 4-3 0-1 0-2-2-3" />
                </svg>
              </ToolBtn>
              <Divider />
              <ToolBtn title="Link" active={isActive('link')} onClick={setLink}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                </svg>
              </ToolBtn>
              <Divider />
              <ToolBtn title="Ordered list" active={isActive('orderedList')} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
                </svg>
              </ToolBtn>
              <ToolBtn title="Bulleted list" active={isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                </svg>
              </ToolBtn>
              <Divider />
              <ToolBtn title="Blockquote" active={isActive('blockquote')} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 21V11a4 4 0 014-4M14 21V11a4 4 0 014-4" />
                </svg>
              </ToolBtn>
              <Divider />
              <ToolBtn title="Code" active={isActive('code')} onClick={() => editor?.chain().focus().toggleCode().run()}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
                </svg>
              </ToolBtn>
              <ToolBtn title="Code block" active={isActive('codeBlock')} onClick={() => editor?.chain().focus().toggleCodeBlock().run()}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M10 10l-2 2 2 2M14 10l2 2-2 2" />
                </svg>
              </ToolBtn>
            </div>

            {/* Editor */}
            <div className="sqc-composer__editor-wrap" onClick={handleEditorBoxClick}>
              <EditorContent editor={editor} />
            </div>

            {/* Bottom action row */}
            <div className="sqc-composer__bottom">
              <div className="sqc-composer__bottom-left">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="sqc-composer__attach"
                  title="Attach file"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 8v8m4-4H8" />
                  </svg>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handlePickFile}
                  accept="image/*,audio/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                />
                <ToolBtn title={showFmt ? 'Hide formatting' : 'Show formatting'} active={showFmt} onClick={() => setShowFmt((v) => !v)}>
                  <span style={{ fontSize: 13, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 2 }}>Aa</span>
                </ToolBtn>
                <div className="relative">
                  <ToolBtn title="Emoji" onClick={() => setShowEmoji((v) => !v)} active={showEmoji}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75z" />
                    </svg>
                  </ToolBtn>
                  {showEmoji && (
                    <div className="absolute bottom-[36px] left-0 z-50">
                      <EmojiPicker onPick={insertEmoji} onClose={() => setShowEmoji(false)} />
                    </div>
                  )}
                </div>
                <ToolBtn title="Mention" onClick={() => editor?.chain().focus().insertContent('@').run()}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="4" />
                    <path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-3.92 7.94" />
                  </svg>
                </ToolBtn>
                <Divider />
                <ToolBtn title="Record voice note" onClick={() => setRecording(true)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                  </svg>
                </ToolBtn>
              </div>

              <div className="sqc-composer__bottom-right">
                <button
                  type="submit"
                  disabled={!canSend}
                  title={pendingFile ? 'Send file' : 'Send'}
                  className={`sqc-composer__send${canSend ? ' is-active' : ''}`}
                >
                  {sending || uploading ? (
                    <span className="text-[11px] font-medium">{uploading ? `${progress}%` : '…'}</span>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Slack-style keyboard hint */}
      {(focused || hasText) && !recording && (
        <div className="sqc-composer__hint">
          <strong>Shift + Return</strong> to add a new line
        </div>
      )}
    </form>
  );
}

