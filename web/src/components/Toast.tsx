'use client';

import { useSyncExternalStore } from 'react';

type TextToast = { id: number; kind: 'text'; message: string; leaving: boolean };
type CardToast = {
  id: number;
  kind: 'card';
  title: string;
  subtitle?: string;
  onClick?: () => void;
  leaving: boolean;
};
type ToastItem = TextToast | CardToast;

let listeners: Array<() => void> = [];
let toasts: ToastItem[] = [];
let nextId = 0;

function emit() {
  listeners.forEach((l) => l());
}

const EXIT_MS = 2000;
const EXIT_EASE = 'cubic-bezier(0.55, 0.06, 0.68, 0.19)';

function dismiss(id: number) {
  toasts = toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, EXIT_MS);
}

export function showToast(message: string) {
  const id = nextId++;
  toasts = [...toasts, { id, kind: 'text', message, leaving: false }];
  emit();
  setTimeout(() => dismiss(id), 2500);
}

export function showToastCard(opts: {
  title: string;
  subtitle?: string;
  onClick?: () => void;
  durationMs?: number;
}) {
  const id = nextId++;
  toasts = [
    ...toasts,
    {
      id,
      kind: 'card',
      title: opts.title,
      subtitle: opts.subtitle,
      onClick: opts.onClick,
      leaving: false,
    },
  ];
  emit();
  setTimeout(() => dismiss(id), opts.durationMs ?? 5000);
}

function subscribe(cb: () => void) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}
function getSnapshot() {
  return toasts;
}

const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const EXIT_TRANSFORM = 'translateX(calc(50vw + 50% + 24px))';

export default function ToastContainer() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!items.length) return null;

  return (
    <>
      <style>{`
        @keyframes sh-toast-in {
          from { opacity: 0; transform: translateY(14px) scale(0.94); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes sh-toast-out {
          from { transform: translateX(0); }
          to   { transform: translateX(calc(50vw + 50% + 24px)); }
        }
      `}</style>
      <div className="fixed inset-0 z-[110] overflow-hidden pointer-events-none">
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
        {items.map((t) =>
          t.kind === 'text' ? (
            <div
              key={t.id}
              className="pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium shadow-lg"
              style={{
                background: 'var(--sh-ink)',
                color: 'var(--surface)',
                animation: t.leaving
                  ? `sh-toast-out ${EXIT_MS}ms ${EXIT_EASE} forwards`
                  : `sh-toast-in 260ms ${EASE} both`,
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M5 12l5 5 9-11" />
              </svg>
              {t.message}
            </div>
          ) : (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                t.onClick?.();
                dismiss(t.id);
              }}
              className="pointer-events-auto flex w-[260px] max-w-[88vw] items-center gap-2.5 rounded-lg px-3 py-2 text-left shadow-lg hover:shadow-xl"
              style={{
                background: 'var(--sh-ink)',
                color: 'var(--surface)',
                animation: t.leaving
                  ? `sh-toast-out ${EXIT_MS}ms ${EXIT_EASE} forwards`
                  : `sh-toast-in 260ms ${EASE} both`,
                transition: `box-shadow 200ms ${EASE}`,
              }}
            >
              <span
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
                style={{ background: 'rgba(255,255,255,0.14)' }}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                {t.subtitle && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide opacity-60 leading-tight">
                    {t.subtitle}
                  </span>
                )}
                <span className="line-clamp-1 text-[12px] font-medium leading-snug">{t.title}</span>
              </span>
            </button>
          ),
        )}
        </div>
      </div>
    </>
  );
}
