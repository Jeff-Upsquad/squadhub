import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';

/**
 * A public lead-capture form (the /apply/* pages) as returned by SquadHire.
 * Kept local to the web app (not in @squadhub/shared) — only this panel consumes
 * it, and the server validates the upstream shape with its own zod schema.
 */
interface PublicCandidateForm {
  form_type: string;
  title: string;
  description: string;
  url_path: string;
  public_url: string;
  enabled: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function PublicFormsPanel({ open, onClose }: Props) {
  const [copiedType, setCopiedType] = useState<string | null>(null);

  // Esc to close + lock body scroll while open (mirrors CandidateSidePanel).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  const { data, isLoading, isError } = useQuery<{ forms: PublicCandidateForm[] }>({
    queryKey: ['candidate-forms'],
    queryFn: async () => {
      const res = await api.get('/candidates/forms');
      return res.data;
    },
    enabled: open,
  });

  const copyLink = async (form: PublicCandidateForm) => {
    try {
      await navigator.clipboard.writeText(form.public_url);
      setCopiedType(form.form_type);
      window.setTimeout(() => setCopiedType((c) => (c === form.form_type ? null : c)), 1800);
    } catch {
      /* clipboard blocked — the Open button still works */
    }
  };

  if (!open || typeof document === 'undefined') return null;

  const forms = data?.forms ?? [];

  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40 transition-opacity" onClick={onClose} />
      <aside className="relative flex w-full max-w-md flex-col bg-canvas shadow-2xl">
        <div className="flex items-center justify-between border-b border-divider bg-surface px-4 py-3">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-sm font-semibold text-foreground">Public Forms</h2>
            <p className="mt-0.5 text-xs text-foreground-muted">Share or open the public application forms.</p>
          </div>
          <button
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
            className="rounded-lg p-2 text-foreground-muted hover:bg-canvas"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl bg-foreground/5" />
              ))}
            </div>
          ) : isError ? (
            <div className="rounded-xl border border-dashed border-divider py-12 text-center text-sm text-foreground-muted">
              Couldn&apos;t load forms right now. Please try again shortly.
            </div>
          ) : !forms.length ? (
            <div className="rounded-xl border border-dashed border-divider py-12 text-center text-sm text-foreground-muted">
              No public forms available for your categories.
            </div>
          ) : (
            <ul className="space-y-3">
              {forms.map((form) => (
                <li
                  key={form.form_type}
                  className="rounded-xl border border-divider bg-surface p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-foreground">{form.title}</h3>
                      {form.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-foreground-muted">{form.description}</p>
                      )}
                    </div>
                    {!form.enabled && (
                      <span className="inline-flex flex-shrink-0 items-center rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] font-medium text-foreground-muted">
                        Disabled
                      </span>
                    )}
                  </div>

                  <p className="mt-2 truncate rounded-lg bg-canvas px-2.5 py-1.5 text-xs text-foreground-muted" title={form.public_url}>
                    {form.public_url}
                  </p>

                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => copyLink(form)}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-divider bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                    >
                      {copiedType === form.form_type ? (
                        <>
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          Copied
                        </>
                      ) : (
                        <>
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                          Copy link
                        </>
                      )}
                    </button>
                    <a
                      href={form.public_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                      Open
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
