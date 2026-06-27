'use client';
import ReactPlayer from 'react-player';
import type { LmsContentBlock } from '@squadhub/shared';
import { useEffect, useRef, useState } from 'react';
import { useClipsAuthBridge } from '../../../../hooks/useClipsAuthBridge';

// Squad Clips links (clips.squadhub.in) point at a full, branded watch page —
// ReactPlayer can't play it and the page chrome looks wrong inline. For
// recognized clip links we render the chrome-free /embed iframe instead;
// everything else stays on ReactPlayer. The host allow-list keeps arbitrary
// pasted URLs from becoming iframe sources.
//
// Two clip embed flavours:
//   • /embed/lms/<token>   — login-gated. The viewer's Squad Hub token must be
//     handed to the iframe (useClipsAuthBridge) or it shows a sign-in gate.
//   • /share|/embed/<token> — public share token, plays with no auth.
function clipEmbedSrc(rawUrl: string): { src: string; gated: boolean } | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const isClipsHost =
    u.hostname === 'clips.squadhub.in' ||
    ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.port === '3200');
  if (!isClipsHost) return null;
  // Login-gated learning embed (preferred): /embed/lms/<token> or a pasted
  // /share/lms/<token> both resolve to the gated player.
  const lms = u.pathname.match(/^\/(?:share|embed)\/lms\/([A-Za-z0-9_-]+)\/?$/);
  if (lms) return { src: `${u.origin}/embed/lms/${lms[1]}`, gated: true };
  // Public share/embed token.
  const m = u.pathname.match(/^\/(?:share|embed)\/([A-Za-z0-9_-]+)\/?$/);
  return m ? { src: `${u.origin}/embed/${m[1]}`, gated: false } : null;
}

export default function VideoEmbedBlock({ block }: { block: LmsContentBlock }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Always wired up; it only acts once an embedded clips iframe announces itself
  // (gated /embed/lms pages do — public /embed pages don't), so it's a no-op for
  // public clips and ReactPlayer URLs.
  useClipsAuthBridge(iframeRef);

  const clip = block.embed_url ? clipEmbedSrc(block.embed_url) : null;

  if (!block.embed_url) {
    return (
      <div className="my-2 rounded-lg border border-dashed border-[var(--sh-hair)] bg-[var(--surface)] px-4 py-6 text-center text-[13px] text-[var(--sh-ink-3)]">
        Missing video embed URL
      </div>
    );
  }

  return (
    <figure className="my-2">
      <div
        className="relative overflow-hidden rounded-lg border border-[var(--sh-hair)] bg-black"
        style={{ aspectRatio: '16 / 9' }}
      >
        {mounted &&
          (clip ? (
            <iframe
              ref={iframeRef}
              src={clip.src}
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
          ))}
      </div>
      {block.caption && (
        <figcaption className="mt-2 text-center text-[13px] text-[var(--sh-ink-3)]">
          {block.caption}
        </figcaption>
      )}
    </figure>
  );
}
