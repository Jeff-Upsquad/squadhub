import ReactPlayer from 'react-player';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { clipEmbedSrc } from '../clip';

export default function EmbedView({ node }: NodeViewProps) {
  const url = (node.attrs.url as string) || '';
  const clip = url ? clipEmbedSrc(url) : null;

  return (
    <NodeViewWrapper className="sh-note-block">
      <div className="sh-note-embed" contentEditable={false}>
        {clip ? (
          <iframe
            src={clip}
            title="Embed"
            className="sh-note-embed__frame"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <ReactPlayer src={url} width="100%" height="100%" controls style={{ position: 'absolute', inset: 0 }} />
        )}
      </div>
    </NodeViewWrapper>
  );
}
