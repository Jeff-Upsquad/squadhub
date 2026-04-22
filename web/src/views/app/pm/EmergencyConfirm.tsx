import { useEffect } from 'react';

export default function EmergencyConfirm({
  taskTitle,
  onConfirm,
  onCancel,
}: {
  taskTitle?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onCancel}
    >
      <div
        className="w-[min(420px,92vw)] rounded-2xl border shadow-2xl"
        style={{ borderColor: 'var(--sh-hair)', background: 'var(--surface)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="px-5 pt-5 pb-1">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="inline-flex items-center justify-center h-7 w-7 rounded-full text-white text-[12px] font-bold"
              style={{ background: '#b91c1c' }}
              aria-hidden
            >
              !
            </span>
            <h2 className="text-[15px] font-semibold text-[color:var(--sh-ink)]">
              Mark as EMERGENCY?
            </h2>
          </div>
          <p className="text-[13px] text-[color:var(--sh-ink-2)] leading-relaxed">
            Use only for critical incidents requiring immediate attention
            {taskTitle ? <> on <span className="font-medium">“{taskTitle}”</span></> : null}.
            This will appear in the EMERGENCY banner for everyone with access to this task.
          </p>
        </div>
        <div className="flex justify-end gap-2 px-5 pb-5 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-[13px] rounded-lg border hover:bg-[color:var(--sh-hair-3)] transition"
            style={{ borderColor: 'var(--sh-hair)', color: 'var(--sh-ink)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-3 py-1.5 text-[13px] font-medium rounded-lg text-white transition"
            style={{ background: '#b91c1c' }}
          >
            Mark EMERGENCY
          </button>
        </div>
      </div>
    </div>
  );
}
