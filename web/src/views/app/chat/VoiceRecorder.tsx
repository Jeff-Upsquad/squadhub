import { useEffect, useRef, useState } from 'react';

interface Props {
  onCancel: () => void;
  onComplete: (blob: Blob, durationMs: number) => void;
}

// Hold-to-record voice notes. Renders an inline strip that replaces the
// composer text input while active. Releasing the mic button while >300ms
// have elapsed commits the recording. Pressing Escape cancels.
//
// Lightweight waveform is rendered by sampling the analyser node at ~30Hz.
export default function VoiceRecorder({ onCancel, onComplete }: Props) {
  const [elapsed, setElapsed] = useState(0); // seconds
  const [samples, setSamples] = useState<number[]>([]); // 0..1 amplitude
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        // Set up analyser for waveform
        const AC = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AC();
        audioCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        analyserRef.current = analyser;

        // Start MediaRecorder
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
        const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        rec.start(100);
        recorderRef.current = rec;
        startedAtRef.current = performance.now();

        // Sampling loop
        const buf = new Uint8Array(analyser.frequencyBinCount);
        let lastTick = 0;
        const tick = (now: number) => {
          if (cancelled || !analyserRef.current) return;
          analyser.getByteTimeDomainData(buf);
          // RMS amplitude (0..1)
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          if (now - lastTick > 80) {
            lastTick = now;
            setSamples((cur) => [...cur.slice(-39), Math.min(1, rms * 3)]);
            setElapsed(Math.floor((performance.now() - startedAtRef.current) / 1000));
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        console.error('Mic access denied:', err);
        alert('Microphone access denied. Allow mic permission and try again.');
        onCancel();
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => {});
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
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
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
    <div className="flex w-full items-center gap-3 rounded-[8px] border border-[#E11D48] bg-[#FFF1F2] px-3 py-2">
      <button
        type="button"
        onClick={handleCancel}
        className="rounded-[4px] p-1 text-[#9F1239] hover:bg-[#FECDD3]"
        title="Cancel"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-[#E11D48]" />
      <span className="font-mono text-[13px] text-[#9F1239]">{fmt(elapsed)}</span>

      {/* Waveform */}
      <div className="flex h-6 flex-1 items-center gap-[2px]">
        {samples.map((s, i) => (
          <span
            key={i}
            className="w-[3px] rounded-full bg-[#E11D48]"
            style={{ height: `${Math.max(4, s * 24)}px` }}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={handleStop}
        className="rounded-[4px] bg-[#007A5A] px-3 py-[6px] text-[13px] font-medium text-white hover:bg-[#148567]"
      >
        Send
      </button>
    </div>
  );
}
