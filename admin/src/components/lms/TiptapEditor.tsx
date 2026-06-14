'use client';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect } from 'react';

interface Props {
  value: unknown | null;          // Tiptap JSON doc
  onChange: (doc: unknown) => void;
  placeholder?: string;
  minHeight?: number;
}

export default function TiptapEditor({ value, onChange, placeholder = 'Write something…', minHeight = 160 }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({}),
      Link.configure({ openOnClick: false, autolink: true }),
      Image.configure({}),
      Placeholder.configure({ placeholder }),
    ],
    content: value || '',
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON());
    },
    immediatelyRender: false,
  });

  // Sync external value changes into editor
  useEffect(() => {
    if (!editor) return;
    const current = JSON.stringify(editor.getJSON());
    const incoming = JSON.stringify(value ?? '');
    if (current !== incoming && value != null) {
      editor.commands.setContent(value as any);
    }
  }, [value, editor]);

  if (!editor) return null;

  return (
    <div className="rounded-lg border border-divider bg-surface">
      <div className="flex flex-wrap items-center gap-1 border-b border-divider px-2 py-1.5">
        <ToolbarButton active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} label="B" className="font-bold" />
        <ToolbarButton active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} label="I" className="italic" />
        <ToolbarButton active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} label="S" className="line-through" />
        <ToolbarButton active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} label="</>" className="font-mono text-[11px]" />
        <div className="mx-1 h-4 w-px bg-well" />
        <ToolbarButton active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} label="H1" />
        <ToolbarButton active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} label="H2" />
        <ToolbarButton active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} label="H3" />
        <div className="mx-1 h-4 w-px bg-well" />
        <ToolbarButton active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} label="•" />
        <ToolbarButton active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} label="1." />
        <ToolbarButton active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} label="❝" />
        <ToolbarButton active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} label="{…}" className="font-mono text-[10px]" />
        <div className="mx-1 h-4 w-px bg-well" />
        <ToolbarButton
          active={editor.isActive('link')}
          onClick={() => {
            const url = window.prompt('URL');
            if (!url) return;
            editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
          }}
          label="🔗"
        />
      </div>
      <div className="tiptap-surface px-3 py-2 text-sm" style={{ minHeight }}>
        <EditorContent editor={editor} />
      </div>
      <style jsx>{`
        .tiptap-surface :global(.ProseMirror) {
          outline: none;
          min-height: ${minHeight - 20}px;
        }
        .tiptap-surface :global(.ProseMirror p.is-editor-empty:first-child::before) {
          content: attr(data-placeholder);
          color: #90A1B9;
          float: left;
          height: 0;
          pointer-events: none;
        }
        .tiptap-surface :global(h1) { font-size: 1.5em; font-weight: 700; margin: 0.4em 0; }
        .tiptap-surface :global(h2) { font-size: 1.25em; font-weight: 700; margin: 0.4em 0; }
        .tiptap-surface :global(h3) { font-size: 1.1em; font-weight: 600; margin: 0.4em 0; }
        .tiptap-surface :global(ul) { list-style: disc; padding-left: 1.5em; }
        .tiptap-surface :global(ol) { list-style: decimal; padding-left: 1.5em; }
        .tiptap-surface :global(blockquote) { border-left: 3px solid #E2E8F0; padding-left: 0.75em; color: #62748E; }
        .tiptap-surface :global(code) { background: #F1F5F9; padding: 0 3px; border-radius: 3px; font-family: ui-monospace, monospace; font-size: 0.9em; }
        .tiptap-surface :global(pre) { background: #0F172B; color: #F8FAFC; padding: 0.75em; border-radius: 6px; overflow-x: auto; }
        .tiptap-surface :global(pre code) { background: transparent; color: inherit; }
        .tiptap-surface :global(a) { color: #2563eb; text-decoration: underline; }
      `}</style>
    </div>
  );
}

function ToolbarButton({ label, active, onClick, className = '' }: { label: string; active: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2 py-1 text-[12px] transition ${active ? 'bg-canvas text-foreground' : 'text-foreground-muted hover:bg-surface-alt'} ${className}`}
    >
      {label}
    </button>
  );
}
