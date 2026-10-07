import { useEffect, useRef, type RefObject } from 'react';
import { usePMStore } from '../../../stores/pmStore';

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Keep keyboard navigation in the topmost goal dialog and return to its trigger. */
export function useGoalDialogFocus(ref: RefObject<HTMLDivElement | null>) {
  const trigger = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : document.activeElement as HTMLElement);
  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const previous = trigger.current;
    if (!panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const dialogs = document.querySelectorAll('.gl-modal-panel, .gl-detail[role="dialog"], .gl-detail-page');
      if (dialogs[dialogs.length - 1] !== panel) return;
      if (!panel.classList.contains('gl-modal-panel') && (usePMStore.getState().activeTaskId || usePMStore.getState().peekTaskId)) return;
      // Date pickers and property menus are portaled beside their dialog.
      const surfaces = [panel, ...document.querySelectorAll('.gl-pop, .dp-panel, .nt-menu')];
      const controls = surfaces.flatMap((surface) => Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE)))
        .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
      const active = document.activeElement;
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); panel.focus(); return; }
      if (event.shiftKey && (active === first || !controls.includes(active as HTMLElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (active === last || !controls.includes(active as HTMLElement))) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      if (previous?.isConnected && (!document.activeElement || document.activeElement === document.body || panel.contains(document.activeElement))) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [ref]);
}
