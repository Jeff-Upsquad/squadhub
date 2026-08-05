'use client';
import { useCallback, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import type { Editor, Range } from '@tiptap/core';
import api from '../../../services/api';
import { sharedExtensions, SlashCommand, toEmbedSrc, providerOf, type SlashItem } from './blocks/notionExtensions';

// A single-document, Notion-style editor for one page. Content is one Tiptap
// doc (headings, lists, to-dos, quotes, dividers, inline images and video
// embeds). Author by typing markdown ("# ", "- ", "> ", "---"), pressing "/"
// for the block menu, or selecting text for the format bar. Saves debounced.
export default function NotionEditor({
  itemId,
  lessonId,
  content,
  onChange,
}: {
  itemId: string;
  lessonId: string;
  content: unknown;
  onChange: (doc: unknown) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingRange = useRef<Range | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Upload an image to R2 (LMS-scoped presign) and return its public URL.
  const uploadImage = useCallback(async (file: File): Promise<string | null> => {
    try {
      const presign = await api.post('/upload/presign-lms', {
        item_id: itemId,
        lesson_id: lessonId,
        filename: file.name,
        content_type: file.type || 'application/octet-stream',
        file_size: file.size,
        file_category: 'image',
      });
      const { uploadUrl, publicUrl } = presign.data.data;
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.send(file);
      });
      return publicUrl as string;
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Image upload failed');
      return null;
    }
  }, [itemId, lessonId]);

  const slashItems = useCallback((): SlashItem[] => [
    { title: 'Text', icon: '¶', desc: 'Plain paragraph', keywords: 'paragraph body',
      action: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
    { title: 'Heading 1', icon: 'H₁', desc: 'Big section heading', keywords: 'title h1',
      action: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 1 }).run() },
    { title: 'Heading 2', icon: 'H₂', desc: 'Medium heading', keywords: 'subtitle h2',
      action: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 2 }).run() },
    { title: 'Heading 3', icon: 'H₃', desc: 'Small heading', keywords: 'h3',
      action: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 3 }).run() },
    { title: 'Bulleted list', icon: '•', desc: 'Simple bullet list', keywords: 'unordered ul',
      action: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
    { title: 'Numbered list', icon: '1.', desc: 'Ordered list', keywords: 'ordered ol',
      action: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
    { title: 'To-do list', icon: '☑', desc: 'Checkbox list', keywords: 'task checkbox todo',
      action: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
    { title: 'Quote', icon: '❝', desc: 'Callout quote', keywords: 'blockquote',
      action: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
    { title: 'Divider', icon: '—', desc: 'Horizontal rule', keywords: 'hr line separator',
      action: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
    { title: 'Code block', icon: '</>', desc: 'Monospace code', keywords: 'pre snippet',
      action: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
    { title: 'Image', icon: '🖼', desc: 'Upload a picture', keywords: 'photo picture upload',
      action: (e, r) => { pendingRange.current = r; e.chain().focus().deleteRange(r).run(); fileRef.current?.click(); } },
    { title: 'Video embed', icon: '▶', desc: 'YouTube, Vimeo, Loom…', keywords: 'youtube vimeo loom video',
      action: (e, r) => {
        const url = window.prompt('Paste a YouTube, Vimeo or Loom link');
        e.chain().focus().deleteRange(r).run();
        if (!url) return;
        const src = toEmbedSrc(url);
        e.chain().focus().insertContent({ type: 'embed', attrs: { src, provider: providerOf(url) } }).run();
      } },
  ], []);

  const editor = useEditor({
    extensions: [
      ...sharedExtensions({ placeholder: "Write something, or press '/' for commands…" }),
      SlashCommand(slashItems),
    ],
    content: (content as any) || '',
    immediatelyRender: false,
    editorProps: {
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        files.forEach(async (f) => { const url = await uploadImage(f); if (url) editor?.chain().focus().setImage({ src: url }).run(); });
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files || []).filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        files.forEach(async (f) => { const url = await uploadImage(f); if (url) editor?.chain().focus().setImage({ src: url }).run(); });
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const json = editor.getJSON();
      saveTimer.current = setTimeout(() => onChange(json), 600);
    },
  });

  // Load new content when switching pages.
  useEffect(() => {
    if (editor && content && !editor.isFocused) editor.commands.setContent(content as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, lessonId]);

  // Flush a pending save on unmount / page switch.
  useEffect(() => () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); if (editor) onChange(editor.getJSON()); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  async function onFilePicked(file: File) {
    const url = await uploadImage(file);
    if (url && editor) editor.chain().focus().setImage({ src: url }).run();
  }

  if (!editor) return null;

  return (
    <div className="lms-notion">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFilePicked(f); e.target.value = ''; }}
      />

      <BubbleMenu editor={editor} className="lms-bubble">
        <BubbleButton editor={editor} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></BubbleButton>
        <BubbleButton editor={editor} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><i>i</i></BubbleButton>
        <BubbleButton editor={editor} active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></BubbleButton>
        <BubbleButton editor={editor} active={editor.isActive('highlight')} onClick={() => editor.chain().focus().toggleHighlight().run()}><span className="hl">H</span></BubbleButton>
        <BubbleButton editor={editor} active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>{'<>'}</BubbleButton>
        <span className="sep" />
        <BubbleButton editor={editor} active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</BubbleButton>
        <BubbleButton editor={editor} active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</BubbleButton>
        <BubbleButton editor={editor} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>•</BubbleButton>
        <BubbleButton editor={editor} active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝</BubbleButton>
        <BubbleButton editor={editor} active={editor.isActive('link')} onClick={() => {
          const prev = editor.getAttributes('link').href as string | undefined;
          const url = window.prompt('Link URL', prev || 'https://');
          if (url === null) return;
          if (url === '') editor.chain().focus().unsetLink().run();
          else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
        }}>🔗</BubbleButton>
      </BubbleMenu>

      <EditorContent editor={editor} />

      <style jsx global>{notionCss}</style>
    </div>
  );
}

function BubbleButton({ active, onClick, children }: { editor: Editor; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={`lms-bb ${active ? 'is-on' : ''}`}
    >
      {children}
    </button>
  );
}

const notionCss = `
.lms-notion .ProseMirror { outline: none; min-height: 40vh; padding-bottom: 30vh; }
.lms-notion .ProseMirror > * + * { margin-top: 0.4em; }
.lms-notion .ProseMirror h1 { font-size: 1.75em; font-weight: 700; margin: 0.7em 0 0.2em; color: var(--sh-ink); letter-spacing: -0.01em; }
.lms-notion .ProseMirror h2 { font-size: 1.4em; font-weight: 700; margin: 0.6em 0 0.2em; color: var(--sh-ink); }
.lms-notion .ProseMirror h3 { font-size: 1.15em; font-weight: 600; margin: 0.5em 0 0.2em; color: var(--sh-ink); }
.lms-notion .ProseMirror p { line-height: 1.65; color: var(--sh-ink-2); }
.lms-notion .ProseMirror ul { list-style: disc; padding-left: 1.5em; }
.lms-notion .ProseMirror ol { list-style: decimal; padding-left: 1.5em; }
.lms-notion .ProseMirror li { margin: 0.15em 0; color: var(--sh-ink-2); }
.lms-notion .ProseMirror blockquote { border-left: 3px solid var(--sh-hair); padding-left: 0.8em; color: var(--sh-ink-3); }
.lms-notion .ProseMirror code { background: var(--sh-hair-3); padding: 1px 5px; border-radius: 3px; font-family: ui-monospace, monospace; font-size: 0.9em; }
.lms-notion .ProseMirror pre { background: var(--sh-ink); color: var(--sidebar); padding: 0.85em; border-radius: 6px; overflow-x: auto; }
.lms-notion .ProseMirror pre code { background: transparent; color: inherit; }
.lms-notion .ProseMirror a { color: #2563eb; text-decoration: underline; }
.lms-notion .ProseMirror mark { background: #fde68a; border-radius: 2px; padding: 0 2px; }
.lms-notion .ProseMirror hr { border: none; border-top: 1px solid var(--sh-hair); margin: 1em 0; }
.lms-notion .ProseMirror img { max-width: 100%; border-radius: 8px; }
.lms-notion .ProseMirror ul[data-type="taskList"] { list-style: none; padding-left: 0.2em; }
.lms-notion .ProseMirror ul[data-type="taskList"] li { display: flex; gap: 0.5em; align-items: flex-start; }
.lms-notion .ProseMirror ul[data-type="taskList"] li > label { margin-top: 0.28em; }
.lms-embed { position: relative; width: 100%; aspect-ratio: 16 / 9; margin: 0.5em 0; border-radius: 8px; overflow: hidden; background: #000; border: 1px solid var(--sh-hair); }
.lms-embed iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.ProseMirror .lms-embed.ProseMirror-selectednode { outline: 2px solid #2563eb; outline-offset: 2px; }
.lms-notion .ProseMirror p.is-editor-empty:first-child::before,
.lms-notion .ProseMirror .is-empty::before {
  content: attr(data-placeholder); color: var(--sh-ink-3); float: left; height: 0; pointer-events: none;
}

/* Slash menu (portaled to body) */
.lms-slash-menu { position: fixed; z-index: 60; width: 284px; max-height: 340px; overflow-y: auto;
  background: var(--surface); border: 1px solid var(--sh-hair); border-radius: 12px;
  box-shadow: 0 12px 32px rgba(16,24,40,.14); padding: 6px; }
.lms-slash-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 8px; border: 0;
  background: transparent; border-radius: 8px; cursor: pointer; text-align: left; }
.lms-slash-item.is-sel { background: var(--sh-hair-3); }
.lms-slash-item .ic { display: grid; place-items: center; width: 30px; height: 30px; flex: 0 0 auto;
  border: 1px solid var(--sh-hair); border-radius: 7px; font-size: 13px; color: var(--sh-ink); background: var(--sidebar); }
.lms-slash-item .tx { display: flex; flex-direction: column; min-width: 0; }
.lms-slash-item .t { font-size: 13.5px; font-weight: 600; color: var(--sh-ink); }
.lms-slash-item .d { font-size: 11.5px; color: var(--sh-ink-3); }
.lms-slash-empty { padding: 10px; font-size: 12.5px; color: var(--sh-ink-3); }

/* Selection bubble */
.lms-bubble { display: flex; align-items: center; gap: 2px; padding: 4px; background: var(--sh-ink);
  border-radius: 9px; box-shadow: 0 8px 22px rgba(0,0,0,.28); }
.lms-bb { min-width: 26px; height: 26px; padding: 0 6px; border: 0; background: transparent; color: #e5e7eb;
  border-radius: 6px; font-size: 13px; cursor: pointer; display: grid; place-items: center; }
.lms-bb:hover { background: rgba(255,255,255,.14); color: #fff; }
.lms-bb.is-on { background: #2563eb; color: #fff; }
.lms-bb .hl { background: #fde68a; color: #111; border-radius: 3px; padding: 0 3px; font-size: 11px; }
.lms-bubble .sep { width: 1px; height: 18px; background: rgba(255,255,255,.18); margin: 0 3px; }
`;
