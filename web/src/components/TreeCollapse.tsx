'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const OPEN_MS = 300;
const CLOSE_MS = 220;

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll') return p;
  }
  return null;
}

// When a subtree collapses near the bottom of a scrolled sidebar, the content
// gets shorter than the scroll position and the browser clamps scrollTop,
// yanking the clicked row down mid-fold. Pad the scroller by the shortfall so
// the row holds still while it folds, then ease the padding away so the menu
// glides to rest — never leaving a dead, unscrollable gap at the bottom.
const holds = new WeakMap<HTMLElement, { base: number; extra: number; timer: ReturnType<typeof setTimeout> }>();
const SETTLE_MS = 320;

function holdScroll(scroller: HTMLElement, collapsingPx: number) {
  const prev = holds.get(scroller);
  const room = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  const need = collapsingPx - room;
  if (need <= 0 && !prev) return;
  const base = prev ? prev.base : parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
  const extra = (prev?.extra ?? 0) + Math.max(0, need);
  if (prev) clearTimeout(prev.timer);
  scroller.style.transition = 'none';
  scroller.style.paddingBottom = `${base + extra}px`;
  const timer = setTimeout(() => {
    scroller.style.transition = `padding-bottom ${SETTLE_MS}ms cubic-bezier(0.25, 1, 0.5, 1)`;
    scroller.style.paddingBottom = `${base}px`;
    const done = setTimeout(() => {
      scroller.style.transition = '';
      scroller.style.paddingBottom = '';
      holds.delete(scroller);
    }, SETTLE_MS + 40);
    holds.set(scroller, { base, extra: 0, timer: done });
  }, CLOSE_MS);
  holds.set(scroller, { base, extra, timer });
}

/**
 * Animated expand/collapse for sidebar tree rows. Height animates via
 * grid-template-rows 0fr→1fr; children fade + drift in with a light stagger.
 * Children stay mounted only while open or mid-close, so collapsed trees
 * cost nothing.
 */
export default function TreeCollapse({ open, className, children }: { open: boolean; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  const [phase, setPhase] = useState<'open' | 'opening' | 'closing' | 'closed'>(open ? 'open' : 'closed');
  const first = useRef(true);

  // Layout effect so the scroll padding lands before the browser paints the shrink.
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!open && ref.current) {
      const scroller = scrollParent(ref.current);
      if (scroller) holdScroll(scroller, ref.current.offsetHeight);
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    setPhase('closing');
    const t = setTimeout(() => { setMounted(false); setPhase('closed'); }, CLOSE_MS);
    return () => clearTimeout(t);
  }, [open]);

  // Once mounted collapsed, force a style flush so 0fr is committed, then flip
  // to open — the browser transitions between them. (No rAF: it stalls in
  // hidden/background tabs.)
  useLayoutEffect(() => {
    if (!open || !mounted || phase === 'opening' || phase === 'open') return;
    void ref.current?.offsetHeight;
    setPhase('opening');
  }, [open, mounted, phase]);

  useEffect(() => {
    if (phase !== 'opening') return;
    const t = setTimeout(() => setPhase('open'), OPEN_MS + 160);
    return () => clearTimeout(t);
  }, [phase]);

  if (!mounted) return null;
  return (
    <div ref={ref} className="sh-tree-collapse" data-phase={phase} aria-hidden={!open}>
      <div className="sh-tree-collapse-inner">
        <div className={className}>{children}</div>
      </div>
    </div>
  );
}
