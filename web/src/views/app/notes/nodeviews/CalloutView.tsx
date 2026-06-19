import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react';

export default function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const emoji = (node.attrs.emoji as string) || '💡';
  return (
    <NodeViewWrapper className="sh-note-callout">
      <button
        type="button"
        contentEditable={false}
        className="sh-note-callout__emoji"
        disabled={!editor.isEditable}
        onClick={() => {
          const next = window.prompt('Callout icon (emoji)', emoji);
          if (next !== null) updateAttributes({ emoji: next.trim() || '💡' });
        }}
      >
        {emoji}
      </button>
      <NodeViewContent className="sh-note-callout__body" />
    </NodeViewWrapper>
  );
}
