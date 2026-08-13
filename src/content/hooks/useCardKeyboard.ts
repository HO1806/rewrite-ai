/**
 * Card-level keyboard handling.
 *
 * Registered in the **capture** phase and stopping propagation, which fixes two
 * problems at once. Previously the listener sat on `window` in the bubble phase:
 * a host page that stops keydown propagation lower in the tree meant Escape
 * never closed the card, and Ctrl+Enter reached the page as well as the card —
 * in Gmail or Slack that sends the message mid-replacement.
 */

import { useEffect, useRef } from 'react';

export interface CardKeyboardActions {
  onDismiss: () => void;
  onConfirm: () => void;
  canConfirm: boolean;
}

export function useCardKeyboard(actions: CardKeyboardActions): void {
  /**
   * Held in a ref so the listener is registered exactly once. Depending on the
   * handlers directly meant the previous implementation tore down and re-added
   * two window listeners on every streamed token.
   */
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        actionsRef.current.onDismiss();
        return;
      }

      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        if (!actionsRef.current.canConfirm) return;
        event.preventDefault();
        event.stopPropagation();
        actionsRef.current.onConfirm();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, []);
}

/** Dismiss the card when the user interacts outside it. */
export function useDismissOnOutsidePointer(
  cardRef: React.RefObject<HTMLElement>,
  onDismiss: () => void,
): void {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const card = cardRef.current;
      if (!card) return;

      // composedPath is required to see through the shadow boundary.
      const path = event.composedPath();
      if (path.includes(card)) return;

      dismissRef.current();
    };

    // Capture phase, for the same reason the keydown listener above uses it:
    // Gmail, Slack and Notion all stopPropagation on mousedown to run their own
    // outside-click logic, so a bubble-phase listener on window never fires and
    // the card becomes impossible to dismiss by clicking away.
    window.addEventListener('mousedown', handlePointerDown, { capture: true });
    return () =>
      window.removeEventListener('mousedown', handlePointerDown, {
        capture: true,
      });
  }, [cardRef]);
}
