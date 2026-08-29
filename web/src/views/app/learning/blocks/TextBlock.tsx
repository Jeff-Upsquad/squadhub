'use client';
import { useEditor, EditorContent } from '@tiptap/react';
import { useEffect } from 'react';
import { sharedExtensions } from './notionExtensions';

export default function TextBlock({ content }: { content: unknown }) {
  const editor = useEditor({
    editable: false,
    // Same schema the Notion editor authors with, so headings, lists, to-dos,
    // images and video embeds render identically here in the reader.
    extensions: sharedExtensions(),
    content: content || '',
    immediatelyRender: false,
  });

  useEffect(() => {
    if (!editor) return;
    if (content) editor.commands.setContent(content as any);
  }, [content, editor]);

  if (!editor) return null;
  return (
    <div className="lms-prose text-[15px] sm:text-[16px]">
      <EditorContent editor={editor} />
      <style jsx>{`
        .lms-prose :global(.ProseMirror) { outline: none; }
        .lms-prose :global(.ProseMirror > *:first-child) { margin-top: 0; }
        .lms-prose :global(h1), .lms-prose :global(h2), .lms-prose :global(h3) { scroll-margin-top: 24px; letter-spacing: -0.018em; }
        .lms-prose :global(h1) { font-size: 1.85em; line-height: 1.2; font-weight: 750; margin: 1.5em 0 0.45em; color: var(--sh-ink); }
        .lms-prose :global(h2) { font-size: 1.45em; line-height: 1.3; font-weight: 700; margin: 1.6em 0 0.5em; color: var(--sh-ink); }
        .lms-prose :global(h3) { font-size: 1.16em; line-height: 1.4; font-weight: 650; margin: 1.35em 0 0.45em; color: var(--sh-ink); }
        .lms-prose :global(p) { line-height: 1.75; margin: 0.7em 0; color: var(--sh-ink-2); }
        .lms-prose :global(ul) { list-style: disc; padding-left: 1.5em; margin: 0.75em 0; }
        .lms-prose :global(ol) { list-style: decimal; padding-left: 1.5em; margin: 0.75em 0; }
        .lms-prose :global(li) { margin: 0.35em 0; line-height: 1.65; color: var(--sh-ink-2); }
        .lms-prose :global(li::marker) { color: var(--sh-ink-3); }
        .lms-prose :global(blockquote) { border-left: 3px solid var(--sh-ink-3); padding: 0.2em 0 0.2em 1em; color: var(--sh-ink-2); margin: 1.1em 0; }
        .lms-prose :global(code) { background: var(--sh-hair-3); padding: 1px 5px; border-radius: 3px; font-family: ui-monospace, monospace; font-size: 0.9em; }
        .lms-prose :global(pre) { background: var(--sh-ink); color: var(--sidebar); padding: 0.85em; border-radius: 6px; overflow-x: auto; margin: 0.6em 0; }
        .lms-prose :global(pre code) { background: transparent; color: inherit; }
        .lms-prose :global(a) { color: #2563eb; text-decoration: underline; }
        .lms-prose :global(img) { display: block; max-width: 100%; height: auto; border: 1px solid var(--sh-hair); border-radius: 10px; margin: 1.25em auto; }
        .lms-prose :global(mark) { background: #fde68a; border-radius: 2px; padding: 0 2px; }
        .lms-prose :global(hr) { border: none; border-top: 1px solid var(--sh-hair); margin: 1.75em 0; }
        .lms-prose :global(ul[data-type="taskList"]) { list-style: none; padding-left: 0.2em; }
        .lms-prose :global(ul[data-type="taskList"] li) { display: flex; gap: 0.5em; align-items: flex-start; }
        .lms-prose :global(.lms-embed) { position: relative; width: 100%; aspect-ratio: 16 / 9; margin: 0.6em 0; border-radius: 8px; overflow: hidden; background: #000; border: 1px solid var(--sh-hair); }
        .lms-prose :global(.lms-embed iframe) { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
      `}</style>
    </div>
  );
}
