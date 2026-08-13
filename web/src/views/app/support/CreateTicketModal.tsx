import { useState } from 'react';
import { createPortal } from 'react-dom';
import { SUPPORT_TICKET_CATEGORIES, type SupportTicketCategory } from '@squadhub/shared';
import { useCreateTicket } from '../../../hooks/useSupport';

const PRIORITIES: { value: 'low' | 'normal' | 'high' | 'urgent'; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export default function CreateTicketModal({
  workspaceId,
  onClose,
  onCreated,
}: {
  workspaceId: string | null;
  onClose: () => void;
  onCreated: (ticketId: string) => void;
}) {
  const [category, setCategory] = useState<SupportTicketCategory>('technical');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const create = useCreateTicket(workspaceId);

  const canSubmit = subject.trim().length >= 3 && description.trim().length >= 1 && !create.isPending;

  const submit = async () => {
    if (!canSubmit) return;
    const ticket = await create.mutateAsync({ category, subject: subject.trim(), description: description.trim(), priority });
    onCreated(ticket.id);
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[95] bg-black/30" onClick={onClose} />
      <div className="fixed inset-0 z-[96] flex items-start justify-center overflow-y-auto p-4 sm:p-8">
        <div
          className="w-full max-w-lg rounded-2xl border border-[var(--sh-hair)] bg-[var(--surface)] shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="flex items-center justify-between border-b border-[var(--sh-hair)] px-5 py-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--sh-ink)] text-white">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-6 0a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </span>
              <h2 className="text-[15px] font-semibold text-[var(--sh-ink)]">New support ticket</h2>
            </div>
            <button onClick={onClose} className="rounded p-1 text-[var(--sh-ink-4)] hover:text-[var(--sh-ink)]" aria-label="Close">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </header>

          <div className="space-y-4 px-5 py-4">
            {/* Category */}
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[var(--sh-ink-2)]">What do you need help with?</label>
              <div className="grid grid-cols-2 gap-2">
                {SUPPORT_TICKET_CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCategory(c.value)}
                    className={`rounded-lg border px-3 py-2.5 text-left transition ${
                      category === c.value
                        ? 'border-[var(--sh-ink)] bg-[var(--sh-hair-3)]'
                        : 'border-[var(--sh-hair)] hover:bg-[var(--sh-hair-3)]'
                    }`}
                  >
                    <div className="text-[13px] font-semibold text-[var(--sh-ink)]">{c.label}</div>
                    <div className="mt-0.5 text-[11px] leading-snug text-[var(--sh-ink-3)]">{c.blurb}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Subject */}
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[var(--sh-ink-2)]">Subject</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={200}
                placeholder="Brief summary of your issue"
                className="w-full rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--sh-ink)] outline-none focus:border-[var(--sh-ink)]"
              />
            </div>

            {/* Description */}
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[var(--sh-ink-2)]">Describe it</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                maxLength={8000}
                placeholder="Share as much detail as you can — what happened, what you expected, any steps to reproduce."
                className="w-full resize-y rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--sh-ink)] outline-none focus:border-[var(--sh-ink)]"
              />
            </div>

            {/* Priority */}
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[var(--sh-ink-2)]">Priority</label>
              <div className="flex gap-2">
                {PRIORITIES.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPriority(p.value)}
                    className={`flex-1 rounded-lg border px-2 py-1.5 text-[12px] font-medium transition ${
                      priority === p.value
                        ? 'border-[var(--sh-ink)] bg-[var(--sh-hair-3)] text-[var(--sh-ink)]'
                        : 'border-[var(--sh-hair)] text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)]'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {create.isError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600">
                Could not create the ticket. Please try again.
              </p>
            )}
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-[var(--sh-hair)] px-5 py-3.5">
            <button onClick={onClose} className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)]">
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!canSubmit}
              className="rounded-lg bg-[var(--sh-ink)] px-4 py-2 text-[13px] font-semibold text-white transition disabled:opacity-40"
            >
              {create.isPending ? 'Creating…' : 'Create ticket'}
            </button>
          </footer>
        </div>
      </div>
    </>,
    document.body,
  );
}
