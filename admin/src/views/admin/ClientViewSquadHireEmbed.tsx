'use client';

import { useEffect, useRef, useState } from 'react';

const EVENT_TYPE = 'squadhire:client-view:event';
const READY_TYPE = 'squadhire:client-view:ready';

export default function ClientViewSquadHireEmbed({
  embedUrl,
  onRemoteEvent,
}: {
  embedUrl: string;
  onRemoteEvent: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(720);

  useEffect(() => {
    let origin = '';
    try {
      origin = new URL(embedUrl).origin;
    } catch {
      return;
    }

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      const type = (data as { type?: string }).type;
      if (type === EVENT_TYPE || type === READY_TYPE) {
        onRemoteEvent();
      }
      const nextHeight = (data as { height?: number }).height;
      if (type === 'squadhire:client-view:resize' && typeof nextHeight === 'number' && nextHeight > 400) {
        setHeight(Math.min(Math.round(nextHeight), 2400));
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [embedUrl, onRemoteEvent]);

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-sh-warm-border)] bg-[var(--color-surface)]">
      <iframe
        ref={frameRef}
        title="SquadHire business review"
        src={embedUrl}
        className="w-full border-0 bg-white"
        style={{ height }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
