import { useEffect, useRef, useState } from 'react';

interface Props {
  onCancel: () => void;
  onComplete: (blob: Blob, durationMs: number) => void;
}

export default function ScreenRecorder({ onCancel, onComplete }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: 'monitor' } as MediaTrackConstraints,
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        // Stop recording when user clicks browser's "Stop sharing" chip
        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (!cancelled) handleStop();
        });

        const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : MediaRecorder.isTypeSupported('video/webm')
            ? 'video/webm'
            : '';
        const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        rec.start(100);
        recorderRef.current = rec;
        startedAtRef.current = performance.now();

        timerRef.current = setInterval(() => {
          setElapsed(Math.floor((performance.now() - startedAtRef.current) / 1000));
        }, 200);
      } catch (err) {
        console.error('Screen capture denied:', err);
        onCancel();
      }
    })();

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStop = () => {
    const rec = recorderRef.current;
    if (!rec) return onCancel();
    const durationMs = performance.now() - startedAtRef.current;
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'video/webm' });
      if (durationMs < 300) {
        onCancel();
        return;
      }
      onComplete(blob, Math.round(durationMs));
    };
    rec.stop();
  };

  const handleCancel = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    onCancel();
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="flex w-full items-center gap-3 rounded-[8px] border border-[#6D28D9] bg-[#F5F3FF] px-3 py-2">
      <button
        type="button"
        onClick={handleCancel}
        className="rounded-[4px] p-1 text-[#5B21B6] hover:bg-[#DDD6FE]"
        title="Cancel"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-[#6D28D9]" />
      <span className="font-mono text-[13px] text-[#5B21B6]">{fmt(elapsed)}</span>

      <span className="flex-1 text-[12px] text-[#6D28D9]">Recording screen…</span>

      <button
        type="button"
        onClick={handleStop}
        className="rounded-[4px] bg-[#007A5A] px-3 py-[6px] text-[13px] font-medium text-white hover:bg-[#148567]"
      >
        Stop &amp; Send
      </button>
    </div>
  );
}
