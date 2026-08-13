/**
 * Dialog focus management.
 *
 * The card is a modal surface but had no focus handling at all: focus never
 * entered it, Tab walked the entire rest of the host document (the host element
 * is appended at the end of body), and closing it dropped focus onto <body>.
 */

import { useEffect } from 'react';

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(containerRef: React.RefObject<HTMLElement>): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus in, preferring the first control over the container itself.
    const initial = container.querySelector<HTMLElement>(FOCUSABLE);
    (initial ?? container).focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      // The active element inside a shadow root is reported on the root itself.
      const root = container.getRootNode() as Document | ShadowRoot;
      const current = root.activeElement;

      if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      // Return focus so the user lands back where they were editing.
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [containerRef]);
}
