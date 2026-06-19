import ReactPlayer from 'react-player';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

function fmtSize(n: number): string {
  if (!n) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let s = n;
  let i = 0;
  while (s >= 1024 && i < units.length - 1) { s /= 1024; i += 1; }
  return `${s.toFixed(s < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export default function FileAttachmentView({ node }: NodeViewProps) {
  const a = node.attrs as { url: string; name: string; size: number; category: string };

  return (
    <NodeViewWrapper className="sh-note-block">
      <div contentEditable={false} className="sh-note-file">
        {a.category === 'audio' ? (
          <audio controls src={a.url} className="sh-note-file__audio" />
        ) : a.category === 'video' ? (
          <div className="sh-note-embed">
            <ReactPlayer src={a.url} width="100%" height="100%" controls style={{ position: 'absolute', inset: 0 }} />
          </div>
        ) : (
          <a href={a.url} target="_blank" rel="noopener noreferrer" className="sh-note-file__doc">
            <span className="sh-note-file__icon">📎</span>
            <span className="sh-note-file__info">
              <span className="sh-note-file__name">{a.name}</span>
              <span className="sh-note-file__size">{fmtSize(a.size)}</span>
            </span>
            <span className="sh-note-file__dl">Download</span>
          </a>
        )}
      </div>
    </NodeViewWrapper>
  );
}
