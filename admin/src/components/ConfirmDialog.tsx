'use client';

import type { ReactNode } from 'react';

type Variant = 'default' | 'danger' | 'warning';

const VARIANT_STYLES: Record<Variant, string> = {
  default: 'bg-[#0F172B] text-white hover:opacity-90',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  warning: 'bg-orange-600 text-white hover:bg-orange-700',
};

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  isPending = false,
  pendingLabel,
  onCancel,
  onConfirm,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: Variant;
  isPending?: boolean;
  pendingLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={isPending ? undefined : onCancel} />
      <div className="relative w-[420px] rounded-lg bg-white p-5 shadow-xl">
        <h4 className="text-base font-semibold text-[#0F172B]">{title}</h4>
        {description && (
          <p className="mt-2 text-sm text-[#62748E]">{description}</p>
        )}
        {children}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={isPending}
            className="rounded-md border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-medium text-[#62748E] hover:bg-[#F8FAFC] disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className={`rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${VARIANT_STYLES[variant]}`}
          >
            {isPending ? (pendingLabel || confirmLabel) : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
