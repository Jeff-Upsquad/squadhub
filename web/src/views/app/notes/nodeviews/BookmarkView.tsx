import { useEffect, useRef } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { fetchUnfurl } from '../../../../hooks/useNotes';

export default function BookmarkView({ node, updateAttributes }: NodeViewProps) {
  const a = node.attrs as {
    url: string;
    title: string | null;
    description: string | null;
    image: string | null;
    favicon: string | null;
  };
  const fetched = useRef(false);

  useEffect(() => {
    if (!a.url || a.title || fetched.current) return;
    fetched.current = true;
    fetchUnfurl(a.url).then((meta) => {
      if (meta && meta.kind === 'bookmark') {
        updateAttributes({
          title: meta.title || a.url,
          description: meta.description || null,
          image: meta.image || null,
          favicon: meta.favicon || null,
          site_name: meta.site_name || null,
        });
      }
    });
  }, [a.url, a.title, updateAttributes]);

  let host = '';
  try { host = new URL(a.url).hostname; } catch { /* ignore */ }

  return (
    <NodeViewWrapper className="sh-note-block">
      <a
        href={a.url}
        target="_blank"
        rel="noopener noreferrer"
        contentEditable={false}
        className="sh-note-bookmark"
      >
        <div className="sh-note-bookmark__main">
          <div className="sh-note-bookmark__title">{a.title || a.url}</div>
          {a.description && <div className="sh-note-bookmark__desc">{a.description}</div>}
          <div className="sh-note-bookmark__meta">
            {a.favicon && <img src={a.favicon} alt="" />}
            <span>{host}</span>
          </div>
        </div>
        {a.image && (
          <div className="sh-note-bookmark__thumb">
            <img src={a.image} alt="" />
          </div>
        )}
      </a>
    </NodeViewWrapper>
  );
}
