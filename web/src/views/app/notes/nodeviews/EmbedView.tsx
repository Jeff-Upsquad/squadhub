import ReactPlayer from 'react-player';
import { useRef } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useClipsAuthBridge } from '../../../../hooks/useClipsAuthBridge';
import { clipEmbedSrc } from '../clip';

export default function EmbedView({ node }: NodeViewProps) {
  const url = (node.attrs.url as string) || '';
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { sendAuth } = useClipsAuthBridge(iframeRef);
  const clip = url ? clipEmbedSrc(url) : null;

  return (
    <NodeViewWrapper className="sh-note-block">
      <div className="sh-note-embed" contentEditable={false}>
        {clip ? (
          <iframe
            ref={iframeRef}
            src={clip.src}
            title="Embed"
            className="sh-note-embed__frame"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            onLoad={() => {
              if (clip.gated) void sendAuth();
            }}
          />
        ) : (
          <ReactPlayer src={url} width="100%" height="100%" controls style={{ position: 'absolute', inset: 0 }} />
        )}
      </div>
    </NodeViewWrapper>
  );
}
