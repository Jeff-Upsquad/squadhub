import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTimerPromptStore } from '../stores/timerPromptStore';

export default function TimerModeDialog() {
  const { prompt, resolve } = useTimerPromptStore();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!prompt) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') resolve?.(false);
      if (event.key === 'Tab') {
        event.preventDefault();
        const cancel = confirmRef.current?.previousElementSibling as HTMLButtonElement | null;
        (document.activeElement === confirmRef.current ? cancel : confirmRef.current)?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previousFocus?.focus();
    };
  }, [prompt, resolve]);

  if (!prompt) return null;
  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45" onClick={() => resolve?.(false)}>
      <div className="sh-float w-[min(460px,92vw)] rounded-2xl border p-5 shadow-2xl"
        style={{ borderColor: 'var(--sh-hair)', background: 'var(--surface)' }}
        role="dialog" aria-modal="true" aria-labelledby="timer-mode-title" aria-describedby="timer-mode-message"
        onClick={(event) => event.stopPropagation()}>
        <h2 id="timer-mode-title" className="text-[15px] font-semibold text-[color:var(--sh-ink)]">{prompt.title}</h2>
        <p id="timer-mode-message" className="mt-2 text-[13px] leading-relaxed text-[color:var(--sh-ink-2)]">{prompt.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="rounded-lg border px-3 py-1.5 text-[13px]"
            style={{ borderColor: 'var(--sh-hair)', color: 'var(--sh-ink)' }} onClick={() => resolve?.(false)}>{prompt.cancelLabel}</button>
          <button ref={confirmRef} type="button" className="rounded-lg bg-[#2962FF] px-3 py-1.5 text-[13px] font-medium text-white"
            onClick={() => resolve?.(true)}>{prompt.confirmLabel}</button>
        </div>
      </div>
    </div>, document.body,
  );
}
