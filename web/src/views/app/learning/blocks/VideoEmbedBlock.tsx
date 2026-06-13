'use client';
import ReactPlayer from 'react-player';
import type { LmsContentBlock } from '@squadhub/shared';
import { useEffect, useState } from 'react';

// Squad Clips share links (clips.squadhub.in/share/<token>) point at a full,
// branded watch page — ReactPlayer can't play it and the page chrome looks
// wrong inline. For recognized clip links, return the chrome-free /embed/<token>
// URL to render in an iframe instead; everything else stays on ReactPlayer.
// The host allow-list keeps arbitrary pasted URLs from becoming iframe sources.
function clipEmbedSrc(rawUrl: string): string | null {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return null; }
  const isClipsHost =
    u.hostname === 'clips.squadhub.in' ||
    ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.port === '3200');
  if (!isClipsHost) return null;
  const m = u.pathname.match(/^\/(?:share|embed)\/([A-Za-z0-9_-]+)\/?$/);
  return m ? `${u.origin}/embed/${m[1]}` : null;
}

export default function VideoEmbedBlock({ block }: { block: LmsContentBlock }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const clipSrc = block.embed_url ? clipEmbedSrc(block.embed_url) : null;

  if (!block.embed_url) {
    return (
      <div className="my-2 rounded-lg border border-dashed border-[var(--sh-hair)] bg-[var(--surface)] px-4 py-6 text-center text-[13px] text-[var(--sh-ink-3)]">
        Missing video embed URL
      </div>
    );
  }

  return (
    <figure className="my-2">
      <div className="relative overflow-hidden rounded-lg border border-[var(--sh-hair)] bg-black" style={{ aspectRatio: '16 / 9' }}>
        {mounted && (
          clipSrc ? (
            <iframe
              src={clipSrc}
              title={block.caption || 'Squad Clip'}
              className="absolute inset-0 h-full w-full"
              style={{ border: 0 }}
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <ReactPlayer
              src={block.embed_url}
              width="100%"
              height="100%"
              controls
              style={{ position: 'absolute', inset: 0 }}
            />
          )
        )}
      </div>
      {block.caption && <figcaption className="mt-2 text-center text-[13px] text-[var(--sh-ink-3)]">{block.caption}</figcaption>}
    </figure>
  );
}
