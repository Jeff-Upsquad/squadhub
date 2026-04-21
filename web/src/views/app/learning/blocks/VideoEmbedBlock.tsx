'use client';
import ReactPlayer from 'react-player';
import type { LmsContentBlock } from '@squadhub/shared';
import { useEffect, useState } from 'react';

export default function VideoEmbedBlock({ block }: { block: LmsContentBlock }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

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
          <ReactPlayer
            src={block.embed_url}
            width="100%"
            height="100%"
            controls
            style={{ position: 'absolute', inset: 0 }}
          />
        )}
      </div>
      {block.caption && <figcaption className="mt-2 text-center text-[13px] text-[var(--sh-ink-3)]">{block.caption}</figcaption>}
    </figure>
  );
}
