'use client';

// Resolves a `data-tip-anchor="<key>"` element to its viewport rect for a
// coachmark. Handles the element not being mounted yet (it re-reads on any DOM
// mutation, throttled to one rAF), and stays glued on scroll/resize. Returns
// found:false when the key isn't present or the element is zero-size/off-screen
// (e.g. inside a collapsed mobile drawer), so the overlay can fall back to a
// centered card.
import { useEffect, useRef, useState } from 'react';

export function useTipAnchor(anchorKey: string | null, active: boolean) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [found, setFound] = useState(false);
  // Last geometry pushed to state — so scroll/mutation churn that doesn't move
  // the anchor doesn't re-render the overlay every frame.
  const prev = useRef<{ top: number; left: number; width: number; height: number } | null>(null);

  useEffect(() => {
    if (!anchorKey || !active) {
      prev.current = null;
      setRect(null);
      setFound(false);
      return;
    }

    const sel = `[data-tip-anchor="${cssEscape(anchorKey)}"]`;
    let raf = 0;
    let cancelled = false;
    prev.current = null;

    const read = () => {
      // A key may be shared by responsive twins (e.g. a mobile + desktop "+"
      // button); pick the first that is actually visible (non-zero-size and not
      // aria-hidden).
      const nodes = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
      for (const n of nodes) {
        if (n.getAttribute('aria-hidden') === 'true') continue;
        const r = n.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          const p = prev.current;
          if (!p || p.top !== r.top || p.left !== r.left || p.width !== r.width || p.height !== r.height) {
            prev.current = { top: r.top, left: r.left, width: r.width, height: r.height };
            setRect(r);
          }
          setFound(true); // no-op re-render when already true (React bails on equal primitive)
          return;
        }
      }
      if (prev.current !== null) {
        prev.current = null;
        setRect(null);
      }
      setFound(false);
    };

    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!cancelled) read();
      });
    };

    read();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden', 'hidden'],
    });

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      mo.disconnect();
    };
  }, [anchorKey, active]);

  return { rect, found };
}

// Minimal CSS attribute-value escape (anchor keys are kebab-case, but be safe).
function cssEscape(v: string): string {
  return v.replace(/["\\]/g, '\\$&');
}
