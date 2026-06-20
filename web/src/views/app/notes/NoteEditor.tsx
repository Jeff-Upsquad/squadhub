'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { useQueryClient } from '@tanstack/react-query';
import { EditorView } from '@tiptap/pm/view';
import api from '../../../services/api';
import { useNotesStore } from '../../../stores/notesStore';
import type { NotePatch } from './types';
import { isUrl } from './clip';
import { useNoteUpload } from './useNoteUpload';
import { Callout } from './extensions/Callout';
import { PageLink } from './extensions/PageLink';
import { Bookmark } from './extensions/Bookmark';
import { Embed } from './extensions/Embed';
import { FileAttachment } from './extensions/FileAttachment';
import { SlashCommand } from './extensions/SlashCommand';
import type { SlashAction, SlashRun } from './components/slashItems';
import BubbleToolbar from './components/BubbleToolbar';
import UrlPasteChooser, { type UrlPasteKind } from './components/UrlPasteChooser';

interface Props {
  noteId: string;
  initialContent: unknown;
  editable: boolean;
  workspaceId: string | undefined;
  save: (patch: NotePatch) => void;
}

function acceptFor(action: SlashAction): string {
  if (action === 'image') return 'image/*';
  if (action === 'video') return 'video/*';
  if (action === 'audio') return 'audio/*';
  return '';
}

export default function NoteEditor({ noteId, initialContent, editable, workspaceId, save }: Props) {
  const editorRef = useRef<Editor | null>(null);
  const runRef = useRef<SlashRun>(() => {});
  const pasteRef = useRef<(view: EditorView, event: ClipboardEvent) => boolean>(() => false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingCatRef = useRef<SlashAction>('file');
  const [chooser, setChooser] = useState<{ url: string; from: number; to: number; x: number; y: number } | null>(null);

  const { upload } = useNoteUpload(noteId);
  const qc = useQueryClient();
  const setActiveNote = useNotesStore((s) => s.setActiveNote);
  const pushRecent = useNotesStore((s) => s.pushRecent);

  const editor = useEditor(
    {
      immediatelyRender: false,
      editable,
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
        Link.configure({ openOnClick: true, autolink: false, HTMLAttributes: { class: 'sh-note-link' } }),
        Placeholder.configure({
          includeChildren: true,
          placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : "Type '/' for commands…"),
        }),
        Highlight.configure({ multicolor: true }),
        Image.configure({ HTMLAttributes: { class: 'sh-note-image' } }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Callout,
        PageLink,
        Bookmark,
        Embed,
        FileAttachment,
        SlashCommand.configure({ run: (action, ed) => runRef.current(action, ed) }),
      ],
      content: (initialContent as object) || { type: 'doc', content: [] },
      editorProps: {
        attributes: { class: 'sh-note-prose', 'aria-label': 'Note editor' },
        handlePaste: (view, event) => pasteRef.current(view, event as unknown as ClipboardEvent),
      },
      onUpdate: ({ editor: ed }) => save({ content: ed.getJSON() }),
    },
    [noteId, editable],
  );

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Slash actions that need React (uploads, sub-page creation, prompts).
  runRef.current = (action, ed) => {
    if (action === 'subpage') {
      api.post('/notes', { parent_id: noteId }).then((r) => {
        const child = r.data.data;
        ed.chain().focus().insertPageLink({ pageId: child.id, title: child.title || 'Untitled', icon: child.icon || null }).run();
        qc.invalidateQueries({ queryKey: ['notes', 'tree', workspaceId] });
        setActiveNote(child.id);
        pushRecent(child.id);
      });
      return;
    }
    if (action === 'embed' || action === 'bookmark') {
      const url = window.prompt(action === 'embed' ? 'Embed URL (YouTube, Vimeo, SquadClips…)' : 'Bookmark URL');
      if (!url) return;
      if (action === 'embed') ed.chain().focus().setEmbed({ url }).run();
      else ed.chain().focus().setBookmark({ url }).run();
      return;
    }
    // image / video / audio / file → open the file picker
    pendingCatRef.current = action;
    if (fileInputRef.current) {
      fileInputRef.current.accept = acceptFor(action);
      fileInputRef.current.click();
    }
  };

  const onFilePicked = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      const res = await upload(file);
      const ed = editorRef.current;
      if (!res || !ed) return;
      if (res.category === 'image') {
        ed.chain().focus().setImage({ src: res.file_url, alt: res.file_name }).run();
      } else {
        ed.chain().focus().setFileAttachment({
          url: res.file_url,
          name: res.file_name,
          size: res.file_size,
          mime: res.file_mime,
          category: res.category as 'audio' | 'video' | 'file',
        }).run();
      }
    },
    [upload],
  );

  // Bare-URL paste → link, or (on collapsed caret) offer link/bookmark/embed.
  pasteRef.current = (view, event) => {
    const text = event.clipboardData?.getData('text/plain')?.trim();
    if (!text || !isUrl(text)) return false;
    const ed = editorRef.current;
    if (!ed) return false;
    const { empty, from } = view.state.selection;
    if (!empty) {
      ed.chain().focus().extendMarkRange('link').setLink({ href: text }).run();
      return true;
    }
    ed.chain().focus().insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href: text } }] }).run();
    const to = from + text.length;
    const coords = view.coordsAtPos(Math.min(to, view.state.doc.content.size));
    setChooser({ url: text, from, to, x: coords.left, y: coords.bottom + 4 });
    return true;
  };

  // Dismiss the paste chooser on outside click / Escape.
  useEffect(() => {
    if (!chooser) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.sh-url-chooser')) setChooser(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setChooser(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [chooser]);

  const onPick = useCallback(
    (kind: UrlPasteKind) => {
      const ed = editorRef.current;
      const c = chooser;
      setChooser(null);
      if (!ed || !c) return;
      if (kind === 'link') return; // already inserted as a link
      const chain = ed.chain().focus().deleteRange({ from: c.from, to: c.to });
      if (kind === 'bookmark') chain.setBookmark({ url: c.url }).run();
      else chain.setEmbed({ url: c.url }).run();
    },
    [chooser],
  );

  return (
    <>
      <EditorContent editor={editor} />
      {editor && editable && <BubbleToolbar editor={editor} />}
      <input ref={fileInputRef} type="file" hidden onChange={onFilePicked} />
      {chooser && <UrlPasteChooser x={chooser.x} y={chooser.y} onPick={onPick} />}
    </>
  );
}
