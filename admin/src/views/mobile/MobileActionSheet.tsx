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
    variant?: 'primary' | 'danger' | 'secondary';
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

  const variantClass = {
    primary:
      'border-2 border-black bg-[#d4ff4d] text-black shadow-[3px_3px_0_0_#000] active:scale-[0.97] active:shadow-[1px_1px_0_0_#000]',
    danger:
      'border-2 border-black bg-[#F76808] text-white shadow-[3px_3px_0_0_#000] active:scale-[0.97] active:shadow-[1px_1px_0_0_#000]',
    secondary:
      'border-2 border-black bg-white text-black shadow-[2px_2px_0_0_#000] active:scale-[0.97] active:shadow-[1px_1px_0_0_#000]',
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg animate-[slideUp_0.25s_ease-out] rounded-t-2xl border-t-2 border-x-2 border-black bg-white px-5 pb-8 pt-4">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#a3a3a3]" />
        <h3 className="font-[family-name:var(--font-jakarta)] text-lg font-bold text-[#0a0a0a]">
          {title}
        </h3>
        {description && (
          <p className="mt-1.5 text-sm text-[#525252]">{description}</p>
        )}
        <div className="mt-5 space-y-2.5">
          {actions.map((action) => (
            <button
              key={action.label}
              onClick={action.onPress}
              disabled={action.disabled}
              className={`w-full rounded-xl px-4 py-3.5 text-sm font-bold transition-transform disabled:opacity-50 ${variantClass[action.variant || 'secondary']}`}
            >
              {action.label}
            </button>
          ))}
          <button
            onClick={onClose}
            className="w-full rounded-xl border-2 border-[#e5e5e5] bg-[#F7F6F3] px-4 py-3.5 text-sm font-semibold text-[#525252] active:scale-[0.97] transition-transform"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
