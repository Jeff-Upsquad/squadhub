'use client';

// A faithful-enough preview of how a Feature Tip will appear to users, rendered
// inside the admin app (the real overlay lives in the web client and anchors to
// real DOM elements, which don't exist here). Shows both shapes:
//   • coachmark — a dim "app" stage with a spotlighted faux target + popover;
//   • centered card — the "What's new" card in the middle of the stage.
// For a guided tour (steps), it steps through them with Back / Next.
// The accent matches the live tooltip (#2962FF) for fidelity; surfaces use admin
// tokens so it adapts to the admin light/dark theme.
import { useEffect, useState } from 'react';
import type { TipStep } from './types';

const ACCENT = '#2962FF';

export default function FeatureTipPreview({
  title,
  body,
  targetView,
  targetAnchor,
  viewLabel,
  steps,
  targetViews,
  onClose,
}: {
  title: string;
  body: string;
  targetView: string | null;
  targetAnchor: string | null;
  viewLabel?: string | null;
  steps?: TipStep[] | null;
  targetViews?: { value: string; label: string }[];
  onClose: () => void;
}) {
  const isTour = !!steps && steps.length > 0;
  const [idx, setIdx] = useState(0);
  const i = isTour ? Math.min(idx, steps!.length - 1) : 0;

  // Active content + placement: the current step for a tour, else the top fields.
  const cur = isTour ? steps![i] : { title, body, target_view: targetView, target_anchor: targetAnchor };
  const isLast = !isTour || i >= steps!.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const anchored = !!cur.target_anchor;
  const screen =
    (cur.target_view && (targetViews?.find((v) => v.value === cur.target_view)?.label || cur.target_view)) ||
    (!isTour ? viewLabel : null) ||
    null;

  const next = () => (isLast ? onClose() : setIdx(i + 1));
  const back = () => setIdx(Math.max(0, i - 1));

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <style>{`@keyframes sh-prev-ring{0%{box-shadow:0 0 0 0 ${ACCENT}}70%{box-shadow:0 0 0 8px rgba(41,98,255,0)}100%{box-shadow:0 0 0 0 rgba(41,98,255,0)}}`}</style>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-xl rounded-xl border border-divider bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-divider px-5 py-3">
          <div>
            <h4 className="text-sm font-semibold text-foreground">
              Preview{isTour ? ` · step ${i + 1} of ${steps!.length}` : ''}
            </h4>
            <p className="text-[11px] text-foreground-muted">
              {anchored
                ? `Coachmark spotlighting ⌖ ${cur.target_anchor}${screen ? ` on the ${screen} screen` : ''}`
                : 'Centered “What’s new” card'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-dim hover:bg-surface-alt hover:text-foreground"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Stage — a faux app viewport */}
        <div className="relative m-4 h-[340px] overflow-hidden rounded-lg border border-divider bg-surface-alt">
          <div className="absolute left-0 top-0 flex h-8 w-full items-center gap-1.5 border-b border-divider bg-surface px-3">
            <span className="h-2.5 w-2.5 rounded-full bg-foreground-dim/40" />
            <span className="h-2.5 w-2.5 rounded-full bg-foreground-dim/40" />
            <span className="h-2.5 w-2.5 rounded-full bg-foreground-dim/40" />
            <span className="ml-2 text-[11px] text-foreground-dim">
              {screen ? `${screen} · Squad Hub` : 'Squad Hub'}
            </span>
          </div>
          <div className="absolute inset-x-0 bottom-0 top-8 bg-black/35" />

          {anchored ? (
            <>
              <div
                className="absolute left-6 top-16 flex h-9 items-center gap-2 rounded-lg border bg-surface px-3 text-xs font-medium text-foreground"
                style={{ borderColor: ACCENT, animation: 'sh-prev-ring 1.6s ease-out infinite' }}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: ACCENT }} />
                {cur.target_anchor}
              </div>
              <div className="absolute left-6 top-[120px] w-[300px]">
                <span className="absolute -top-1.5 left-6 h-3 w-3 rotate-45 border-l border-t border-divider bg-surface" />
                <PreviewCard
                  title={cur.title}
                  body={cur.body}
                  isTour={isTour}
                  stepIndex={i}
                  stepCount={isTour ? steps!.length : 1}
                  isLast={isLast}
                  targetView={cur.target_view}
                  onClose={onClose}
                  onNext={next}
                  onBack={back}
                  popover
                />
              </div>
            </>
          ) : (
            <div className="absolute left-1/2 top-1/2 w-[320px] -translate-x-1/2 -translate-y-1/2">
              <PreviewCard
                title={cur.title}
                body={cur.body}
                isTour={isTour}
                stepIndex={i}
                stepCount={isTour ? steps!.length : 1}
                isLast={isLast}
                targetView={cur.target_view}
                onClose={onClose}
                onNext={next}
                onBack={back}
              />
            </div>
          )}
        </div>

        <p className="px-5 pb-4 text-[11px] text-foreground-dim">
          {isTour
            ? 'Approximation only — the live tour uses real elements and navigates between screens. “Done” accepts; “Skip” snoozes for 3 hours.'
            : 'Approximation only — the live tooltip uses the app’s real element and theme. “Got it” accepts; “Dismiss” snoozes for 3 hours; “Show me” navigates the user to the target screen.'}
        </p>
      </div>
    </div>
  );
}

function PreviewCard({
  title,
  body,
  isTour,
  stepIndex,
  stepCount,
  isLast,
  targetView,
  onClose,
  onNext,
  onBack,
  popover,
}: {
  title: string;
  body: string;
  isTour: boolean;
  stepIndex: number;
  stepCount: number;
  isLast: boolean;
  targetView: string | null;
  onClose: () => void;
  onNext: () => void;
  onBack: () => void;
  popover?: boolean;
}) {
  return (
    <div className={`relative rounded-2xl border border-divider bg-surface shadow-2xl ${popover ? 'p-4' : 'p-5'}`}>
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
        style={{ background: 'rgba(41,98,255,0.12)', color: ACCENT }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18h6M10 22h4" />
          <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1v.2h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" />
        </svg>
        {isTour ? 'Quick tour' : "What's new"}
      </span>
      <h3 className={`${popover ? 'mt-2.5 text-sm' : 'mt-3 text-base'} font-semibold text-foreground`}>
        {title || <span className="text-foreground-dim">Tip title…</span>}
      </h3>
      <p className={`mt-1 whitespace-pre-line leading-relaxed text-foreground-muted ${popover ? 'text-[13px]' : 'text-sm'}`}>
        {body || <span className="text-foreground-dim">Tip body…</span>}
      </p>

      {isTour ? (
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-foreground-dim">{stepIndex + 1} of {stepCount}</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-foreground-muted hover:bg-surface-alt">Skip</button>
            {stepIndex > 0 && (
              <button onClick={onBack} className="rounded-lg border border-divider px-3 py-1.5 text-sm font-medium text-foreground-muted hover:bg-surface-alt">Back</button>
            )}
            <button onClick={onNext} className="rounded-lg px-3.5 py-1.5 text-sm font-semibold text-white" style={{ background: ACCENT }}>{isLast ? 'Done' : 'Next'}</button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm font-medium text-foreground-muted hover:bg-surface-alt">
            Dismiss
          </button>
          {targetView && (
            <button onClick={onClose} className="rounded-lg border border-divider px-3 py-1.5 text-sm font-medium" style={{ color: ACCENT }}>
              Show me
            </button>
          )}
          <button onClick={onClose} className="rounded-lg px-3.5 py-1.5 text-sm font-semibold text-white" style={{ background: ACCENT }}>
            Got it
          </button>
        </div>
      )}
    </div>
  );
}
