import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useNotesStore } from '../../../../stores/notesStore';

export default function PageLinkView({ node }: NodeViewProps) {
  const { pageId, title, icon } = node.attrs as { pageId: string; title: string; icon: string | null };
  const setActiveNote = useNotesStore((s) => s.setActiveNote);
  const pushRecent = useNotesStore((s) => s.pushRecent);

  return (
    <NodeViewWrapper className="sh-note-pagelink-wrap">
      <button
        type="button"
        contentEditable={false}
        className="sh-note-pagelink"
        onClick={() => {
          if (pageId) {
            setActiveNote(pageId);
            pushRecent(pageId);
          }
        }}
      >
        <span className="sh-note-pagelink__icon">{icon || '📄'}</span>
        <span className="sh-note-pagelink__title">{title || 'Untitled'}</span>
      </button>
    </NodeViewWrapper>
  );
}
