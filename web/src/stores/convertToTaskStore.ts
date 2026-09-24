import { create } from 'zustand';
import type { Message, TaskComment } from '@squadhub/shared';

// "Convert to task" — turns a chat message, a whole thread, or a task comment
// into a prefilled TaskCreatePanel. Callers build a ConvertSource with one of
// the helpers below and hand it to `open`; MainLayout hosts the single
// <ConvertToTaskModal /> that reads it.

export type ConvertSourceKind = 'message' | 'thread' | 'comment';

export interface ConvertSource {
  kind: ConvertSourceKind;
  title: string;
  description: string;
  // Default destination — task comments keep the parent task's list; chat
  // sources leave the picker empty so the user chooses where it goes.
  spaceId?: string | null;
  listId?: string | null;
}

interface ConvertToTaskState {
  source: ConvertSource | null;
  open: (source: ConvertSource) => void;
  close: () => void;
}

export const useConvertToTaskStore = create<ConvertToTaskState>((set) => ({
  source: null,
  open: (source) => set({ source }),
  close: () => set({ source: null }),
}));

const TITLE_MAX = 120;

// Chat bodies are composer markdown (**bold**, _italic_, ~~strike~~, `code`,
// [text](url), fences, quotes, lists). Task titles are plain text, so strip
// the syntax but keep the words.
export function stripChatMarkdown(text: string): string {
  return text
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/(^|\W)_(.+?)_(?=\W|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ');
}

// First non-empty line, bullets/numbering dropped, clipped to a sane length.
export function titleFromText(text: string, fallback: string): string {
  const firstLine = stripChatMarkdown(text)
    .split('\n')
    .map((l) => l.replace(/^•\s*/, '').replace(/^\d+\.\s+/, '').trim())
    .find(Boolean);
  if (!firstLine) return fallback;
  return firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX - 1).trimEnd()}…` : firstLine;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Text for a single chat message, including a note for attachments so a
// file/voice/image message still reads sensibly in the description.
function messageBody(m: Message): string {
  const text = stripChatMarkdown(m.content || '').trim();
  const attachment = m.file_url ? `[${m.type === 'audio' ? 'Voice note' : 'Attachment'}: ${m.file_name || m.file_url}]` : '';
  return [text, attachment].filter(Boolean).join('\n');
}

function messageTitleFallback(m: Message): string {
  if (m.file_name) return `Follow up on ${m.file_name}`;
  return 'Follow up on chat message';
}

function quoteLine(m: Message): string {
  const who = m.sender?.display_name || 'Someone';
  return `${who} · ${formatWhen(m.created_at)}\n${messageBody(m)}`;
}

export function sourceFromMessage(message: Message, contextLabel?: string): ConvertSource {
  const where = contextLabel ? ` in ${contextLabel}` : '';
  return {
    kind: 'message',
    title: titleFromText(message.content || '', messageTitleFallback(message)),
    description: `${messageBody(message)}\n\n— From chat${where}: ${message.sender?.display_name || 'Someone'}, ${formatWhen(message.created_at)}`,
  };
}

export function sourceFromThread(root: Message, replies: Message[], contextLabel?: string): ConvertSource {
  const where = contextLabel ? ` in ${contextLabel}` : '';
  const live = replies.filter((r) => !r.is_deleted);
  const transcript = [root, ...live].map(quoteLine).join('\n\n');
  const count = live.length;
  return {
    kind: 'thread',
    title: titleFromText(root.content || '', messageTitleFallback(root)),
    description: `${transcript}\n\n— From a chat thread${where} (${count} ${count === 1 ? 'reply' : 'replies'})`,
  };
}

export function sourceFromComment(
  comment: TaskComment,
  parentTask: { title: string; list_id: string },
  spaceId?: string | null,
): ConvertSource {
  const who = comment.user?.display_name || comment.user?.email || 'Someone';
  return {
    kind: 'comment',
    title: titleFromText(comment.content || '', `Follow up on “${parentTask.title}”`),
    description: `${comment.content}\n\n— From a comment by ${who} on “${parentTask.title}”, ${formatWhen(comment.created_at)}`,
    spaceId: spaceId ?? null,
    listId: parentTask.list_id,
  };
}
