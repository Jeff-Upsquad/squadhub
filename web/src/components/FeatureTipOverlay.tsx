'use client';

// The user-facing Feature Tip overlay. Renders the current pending tip (from
// featureTipStore) as either:
//   • a coachmark — a spotlight + popover anchored to a UI element, when the
//     tip has a `target_anchor` that resolves on screen; or
//   • a centered "What's New" card otherwise.
// When a tip targets a screen the user isn't on, the card offers "Show me",
// which navigates there (guided nav) so the coachmark can resolve.
//
// Acknowledgement is non-blocking but persistent: "Got it" accepts permanently;
// "Dismiss" snoozes for 3h (server-side) and the tip returns until accepted.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { featureTipStore, useCurrentTip } from '../stores/featureTipStore';
import { useTipAnchor } from '../hooks/useTipAnchor';

const POP_W = 300;

export default function FeatureTipOverlay() {
  const tip = useCurrentTip();
  const queryClient = useQueryClient();
  const [guided, setGuided] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const { rect, found } = useTipAnchor(tip?.target_anchor ?? null, !!tip);

  // Reset the guided flag whenever a different tip becomes current.
  useEffect(() => {
    setGuided(false);
  }, [tip?.id, tip?.revision]);

  const refetch = () => queryClient.invalidateQueries({ queryKey: ['feature-tips', 'pending'] });

  const accept = useMutation({
    mutationFn: (v: { id: string; revision: number }) =>
      api.post(`/feature-tips/${v.id}/accept`, { revision: v.revision }),
    onSuccess: () => {
      featureTipStore.next();
      refetch();
    },
    // 409 = the tip was re-issued to a new revision since we rendered it; just
    // re-fetch so the new round's card replaces this one (don't drop it).
    onError: refetch,
  });
  const dismiss = useMutation({
    mutationFn: (v: { id: string; revision: number }) =>
      api.post(`/feature-tips/${v.id}/dismiss`, { revision: v.revision }),
    onSuccess: () => {
      featureTipStore.next();
      refetch();
    },
    onError: refetch,
  });

  const busy = accept.isPending || dismiss.isPending;
  const doAccept = () => tip && !busy && accept.mutate({ id: tip.id, revision: tip.revision });
  const doDismiss = () => tip && !busy && dismiss.mutate({ id: tip.id, revision: tip.revision });
  const showMe = () => {
    if (tip?.target_view) {
      featureTipStore.requestNavigate(tip.target_view);
      setGuided(true);
    }
  };

  // Esc dismisses (snooze) — non-blocking. Focus the primary action on open.
  useEffect(() => {
    if (!tip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') doDismiss();
    };
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => primaryRef.current?.focus(), 50);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tip?.id, tip?.revision, busy]);

  if (!tip) return null;

  const hasAnchor = !!tip.target_anchor;
  const coachmark = hasAnchor && found && !!rect;
  const canGuide = !!tip.target_view && !coachmark && !guided;

  const keyframes = (
    <style>{`
      @keyframes sh-tip-in { from { opacity: 0; transform: translateY(8px) scale(0.97); } to { opacity: 1; transform: none; } }
      @keyframes sh-tip-ring { 0% { box-shadow: 0 0 0 0 var(--color-accent); opacity: 1; } 70% { box-shadow: 0 0 0 8px rgba(41,98,255,0); opacity: 0.85; } 100% { box-shadow: 0 0 0 0 rgba(41,98,255,0); opacity: 1; } }
    `}</style>
  );

  const card = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sh-tip-title"
      className="relative w-full max-w-sm rounded-2xl border border-[var(--sh-hair)] bg-[var(--surface)] p-5 shadow-2xl"
      style={{ animation: `sh-tip-in 220ms cubic-bezier(0.32,0.72,0,1) both` }}
    >
      <Badge />
      <h3 id="sh-tip-title" className="mt-3 text-base font-semibold text-[var(--sh-ink)]">
        {tip.title}
      </h3>
      <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-[var(--sh-ink-3)]">
        {tip.body}
      </p>
      <Actions
        primaryRef={primaryRef}
        busy={busy}
        canGuide={canGuide}
        onAccept={doAccept}
        onDismiss={doDismiss}
        onShowMe={showMe}
      />
    </div>
  );

  // Centered card: no usable anchor, or anchor not (yet) on screen.
  if (!coachmark) {
    return (
      <>
        {keyframes}
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={doDismiss} />
          {card}
        </div>
      </>
    );
  }

  // Coachmark: spotlight (four dim panes around a hole) + ring + anchored popover.
  const pad = 8;
  const hole = {
    top: rect!.top - pad,
    left: rect!.left - pad,
    width: rect!.width + pad * 2,
    height: rect!.height + pad * 2,
  };
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const placeAbove = vh - rect!.bottom < 200 && rect!.top > 200;
  let left = rect!.left + rect!.width / 2 - POP_W / 2;
  left = Math.max(8, Math.min(left, vw - POP_W - 8));
  const popStyle: React.CSSProperties = placeAbove
    ? { position: 'fixed', width: POP_W, left, bottom: vh - hole.top + 10 }
    : { position: 'fixed', width: POP_W, left, top: hole.top + hole.height + 10 };

  const dim = 'fixed bg-black/50';
  return (
    <>
      {keyframes}
      <div className="fixed inset-0 z-[120]" style={{ pointerEvents: 'none' }}>
        {/* Spotlight: dim everything except the hole around the anchor. */}
        <div className={dim} style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
        <div className={dim} style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }} />
        <div className={dim} style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }} />
        <div className={dim} style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
        {/* Highlight ring around the anchor. */}
        <div
          className="fixed rounded-lg"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
            border: '2px solid var(--color-accent)',
            animation: 'sh-tip-ring 1.6s ease-out infinite',
          }}
        />
        {/* Popover */}
        <div
          role="dialog"
          aria-modal="false"
          aria-labelledby="sh-tip-title"
          className="rounded-2xl border border-[var(--sh-hair)] bg-[var(--surface)] p-4 shadow-2xl"
          style={{ ...popStyle, pointerEvents: 'auto', animation: 'sh-tip-in 220ms cubic-bezier(0.32,0.72,0,1) both' }}
        >
          <Badge />
          <h3 id="sh-tip-title" className="mt-2.5 text-sm font-semibold text-[var(--sh-ink)]">
            {tip.title}
          </h3>
          <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-[var(--sh-ink-3)]">
            {tip.body}
          </p>
          <Actions
            primaryRef={primaryRef}
            busy={busy}
            canGuide={false}
            onAccept={doAccept}
            onDismiss={doDismiss}
            onShowMe={showMe}
          />
        </div>
      </div>
    </>
  );
}

function Badge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)' }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18h6M10 22h4" />
        <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1v.2h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" />
      </svg>
      What&apos;s new
    </span>
  );
}

function Actions({
  primaryRef,
  busy,
  canGuide,
  onAccept,
  onDismiss,
  onShowMe,
}: {
  primaryRef: React.RefObject<HTMLButtonElement | null>;
  busy: boolean;
  canGuide: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  onShowMe: () => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onDismiss}
        disabled={busy}
        className="rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] disabled:opacity-50"
      >
        Dismiss
      </button>
      {canGuide && (
        <button
          type="button"
          onClick={onShowMe}
          disabled={busy}
          className="rounded-lg border border-[var(--sh-hair)] px-3 py-1.5 text-sm font-medium text-[var(--color-accent)] hover:bg-[var(--sh-hair-3)] disabled:opacity-50"
        >
          Show me
        </button>
      )}
      <button
        ref={primaryRef}
        type="button"
        onClick={onAccept}
        disabled={busy}
        className="rounded-lg px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition disabled:opacity-50"
        style={{ background: 'var(--color-accent)' }}
      >
        Got it
      </button>
    </div>
  );
}
