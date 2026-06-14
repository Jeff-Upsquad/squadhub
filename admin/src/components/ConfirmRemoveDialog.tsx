import { useEffect, useState } from 'react';

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmWord?: string;
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

/**
 * Two-step destructive confirmation. User must type the exact confirmWord
 * (default "REMOVE", case-sensitive) before the Confirm button enables.
 */
export default function ConfirmRemoveDialog({
  open, title, description, confirmWord = 'REMOVE', loading, onClose, onConfirm,
}: Props) {
  const [input, setInput] = useState('');

  useEffect(() => {
    if (!open) setInput('');
  }, [open]);

  if (!open) return null;

  const matches = input === confirmWord;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={loading ? undefined : onClose} />
      <div className="relative w-full max-w-sm rounded-xl border border-divider bg-surface p-5 shadow-2xl">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm text-foreground-muted">{description}</p>

        <div className="mt-4 space-y-1.5">
          <label className="block text-xs font-medium text-foreground-muted">
            Type <span className="font-mono font-semibold text-foreground">{confirmWord}</span> to confirm
          </label>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
            disabled={loading}
            className="w-full rounded-md border border-divider bg-surface px-2 py-1.5 text-sm font-mono text-foreground focus:border-accent focus:outline-none"
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-md border border-divider px-3 py-1.5 text-sm font-medium text-foreground hover:bg-canvas disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!matches || loading}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Removing…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
