'use client';

import { useEffect } from 'react';

export default function MobileActionSheet({
  open,
  onClose,
  title,
  description,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  actions: {
    label: string;
    variant?: 'primary' | 'danger' | 'secondary' | 'warning' | 'violet' | 'success' | 'info';
    disabled?: boolean;
    onPress: () => void;
  }[];
}) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative w-full max-w-lg rounded-t-2xl border-t border-x border-[var(--color-sh-warm-border)] bg-white px-5 pb-8 pt-4"
        style={{ animation: 'slideUp 0.25s ease-out' }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--color-sh-ink-faint)]" />
        <h3 className="text-lg font-semibold text-[var(--color-sh-ink)]">
          {title}
        </h3>
        {description && (
          <p className="mt-1.5 text-sm text-[var(--color-sh-ink-muted)]">{description}</p>
        )}
        <div className="mt-5 space-y-2">
          {actions.map((action) => {
            const cls =
              action.variant === 'primary'
                ? 'sh-btn-primary'
                : action.variant === 'danger'
                ? 'sh-btn-danger'
                : action.variant === 'warning'
                ? 'sh-btn-warning'
                : action.variant === 'violet'
                ? 'sh-btn-violet'
                : action.variant === 'success'
                ? 'sh-btn-success'
                : action.variant === 'info'
                ? 'sh-btn-info'
                : 'sh-btn-ghost';
            return (
              <button
                key={action.label}
                onClick={action.onPress}
                disabled={action.disabled}
                className={`${cls} w-full`}
                style={{ padding: '0.875rem 1rem', fontSize: '0.875rem' }}
              >
                {action.label}
              </button>
            );
          })}
          <button
            onClick={onClose}
            className="sh-btn-ghost w-full"
            style={{ padding: '0.875rem 1rem', fontSize: '0.875rem' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
