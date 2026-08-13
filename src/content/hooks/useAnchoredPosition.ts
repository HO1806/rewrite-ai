/**
 * Keeps the card anchored to its selection.
 *
 * Coordinates used to be frozen at mount with no scroll or resize listener
 * anywhere in the content script, so scrolling detached the card from the text
 * it referred to and left it hovering over unrelated content.
 */

import { useEffect, useState } from 'react';
import { positionBelow } from '../selection';
import type { CardPosition, SelectionInfo } from '@/shared/types';

export function useAnchoredPosition(
  selectionInfo: SelectionInfo,
): CardPosition {
  const [position, setPosition] = useState<CardPosition>(
    selectionInfo.position,
  );

  useEffect(() => {
    const anchor = resolveAnchor(selectionInfo);
    if (!anchor) return;

    let frame = 0;
    const reposition = () => {
      cancelAnimationFrame(frame);
      // Coalesce bursts of scroll events into one measurement per frame.
      frame = requestAnimationFrame(() => {
        const rect = anchor();
        if (rect) setPosition(positionBelow(rect));
      });
    };

    window.addEventListener('scroll', reposition, {
      passive: true,
      capture: true,
    });
    window.addEventListener('resize', reposition, { passive: true });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', reposition, { capture: true });
      window.removeEventListener('resize', reposition);
    };
  }, [selectionInfo]);

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
