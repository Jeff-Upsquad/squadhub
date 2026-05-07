'use client';

import { useSyncExternalStore } from 'react';

type ToastType = 'success' | 'error' | 'info';
type ToastItem = { id: number; message: string; type: ToastType; leaving: boolean };

let listeners: Array<() => void> = [];
let toasts: ToastItem[] = [];
let nextId = 0;

function emit() {
  listeners.forEach((l) => l());
}

export function showToast(message: string, type: ToastType = 'info') {
  const id = nextId++;
  toasts = [...toasts, { id, message, type, leaving: false }];
  emit();
  const duration = type === 'error' ? 4000 : 2500;
  setTimeout(() => {
    toasts = toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
    emit();
    setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== id);
      emit();
    }, 260);
  }, duration);
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

const BG: Record<ToastType, string> = {
  success: '#0F172B',
  info: '#0F172B',
  error: '#DC2626',
};

const ICONS: Record<ToastType, string> = {
  success: 'M5 12l5 5 9-11',
  info: 'M12 8v4m0 4h.01',
  error: 'M6 18L18 6M6 6l12 12',
};

export default function ToastContainer() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!items.length) return null;

  return (
    <div className="fixed bottom-6 left-1/2 z-[110] flex -translate-x-1/2 flex-col items-center gap-2 pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium text-white shadow-lg transition-all duration-[260ms]"
          style={{
            background: BG[t.type],
            opacity: t.leaving ? 0 : 1,
            transform: t.leaving ? 'translateY(8px)' : 'translateY(0)',
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
            <path d={ICONS[t.type]} />
          </svg>
          {t.message}
        </div>
      ))}
    </div>
  );
}
