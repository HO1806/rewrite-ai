/**
 * Keeps the card anchored to its selection.
 *
 * Coordinates used to be frozen at mount with no scroll or resize listener
 * anywhere in the content script, so scrolling detached the card from the text
 * it referred to and left it hovering over unrelated content.
 */

import { useEffect, useState } from 'react';
import { positionBelow } from '../selection';
import { CARD } from '@/shared/constants';
import type { CardPosition, SelectionInfo } from '@/shared/types';

export function useAnchoredPosition(
  selectionInfo: SelectionInfo,
  cardRef: React.RefObject<HTMLElement>,
): CardPosition {
  const [position, setPosition] = useState<CardPosition>(
    selectionInfo.position,
  );

  useEffect(() => {
    const anchor = resolveAnchor(selectionInfo);
    if (!anchor) return;

    /**
     * Measure the card rather than guessing. The initial position is computed
     * before the card exists, from an estimate; once it is on screen its real
     * height is known, and the drawer opening changes it again.
     */
    const reposition = () => {
      const rect = anchor();
      if (!rect) return;
      const height = cardRef.current?.offsetHeight || CARD.height;
      setPosition(positionBelow(rect, height));
    };

    reposition();

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      // Coalesce bursts of scroll events into one measurement per frame.
      frame = requestAnimationFrame(reposition);
    };

    window.addEventListener('scroll', schedule, {
      passive: true,
      capture: true,
    });
    window.addEventListener('resize', schedule, { passive: true });

    // The card's height changes when the adjust drawer opens or an error appears.
    const card = cardRef.current;
    const observer = card ? new ResizeObserver(schedule) : null;
    if (card && observer) observer.observe(card);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
    };
  }, [selectionInfo, cardRef]);

  return position;
}

/** A function that re-measures the selection's rect, or null if unmeasurable. */
function resolveAnchor(
  selectionInfo: SelectionInfo,
): (() => DOMRect | null) | null {
  const { element, range } = selectionInfo;

  if (range) {
    return () =>
      range.startContainer.isConnected ? range.getBoundingClientRect() : null;
  }
  if (element) {
    return () => (element.isConnected ? element.getBoundingClientRect() : null);
  }
  return null;
}
