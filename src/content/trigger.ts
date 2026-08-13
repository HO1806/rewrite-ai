/**
 * The inline rewrite offer.
 *
 * Edge's Rewrite feels native because it offers itself the moment you select
 * text in an editable field, rather than waiting to be found in a context menu.
 * This module watches the selection and floats a small button beside it.
 *
 * It is the only part of the extension that runs continuously on every page, so
 * the hot path is deliberately cheap: the handler bails on a collapsed selection
 * before touching anything else, and all work is coalesced into one animation
 * frame so a drag-select does not queue a measurement per mousemove.
 */

import { createElement } from 'react';
import type { CardPosition, SelectionInfo } from '@/shared/types';
import { RewriteTrigger } from './components/RewriteTrigger';
import {
  applySurfaceTheme,
  isSurfaceMounted,
  mountSurface,
  unmountSurface,
} from './mount';
import { getEditableSelectionInfo, positionTrigger } from './selection';
import { loadResolvedTheme } from './theme';

type OpenCard = (selectionInfo: SelectionInfo) => void;

/** Cached so the button can show the user's real binding, not a guess. */
let shortcut: string | null = null;

/**
 * Resolved once at registration rather than per mount.
 *
 * The button mounts and unmounts on every selection change, so reading storage
 * each time would be wasteful, and subscribing to changes would put a
 * chrome.storage listener in every frame of every page for something purely
 * cosmetic. The cost is that changing the theme mid-session leaves the button
 * stale until the page reloads; the card, which opens rarely, re-resolves.
 */
let theme: 'light' | 'dark' = 'dark';

let currentSelection: SelectionInfo | null = null;
let frame = 0;

export function registerInlineTrigger(openCard: OpenCard): void {
  void loadShortcut();
  void loadTheme();

  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => evaluate(openCard));
  };

  // `selectionchange` covers keyboard selection and programmatic changes;
  // mouseup and keyup catch the end of a drag, where selectionchange has
  // already fired mid-gesture with a partial range.
  document.addEventListener('selectionchange', schedule, { passive: true });
  document.addEventListener('mouseup', schedule, {
    passive: true,
    capture: true,
  });
  document.addEventListener('keyup', schedule, {
    passive: true,
    capture: true,
  });

  // Reposition with the page rather than leaving the button behind.
  window.addEventListener('scroll', schedule, { passive: true, capture: true });
  window.addEventListener('resize', schedule, { passive: true });

  // Escape dismisses the offer without disturbing the page.
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && isSurfaceMounted('trigger')) hide();
    },
    { capture: true },
  );
}

/** Hide the button, e.g. because the card is opening. */
export function hideInlineTrigger(): void {
  hide();
}

function evaluate(openCard: OpenCard): void {
  const info = getEditableSelectionInfo();

  if (!info) {
    hide();
    return;
  }

  // Never compete with the card for the same selection.
  if (isSurfaceMounted('card')) {
    hide();
    return;
  }

  const anchor = anchorRect(info);
  if (!anchor) {
    hide();
    return;
  }

  currentSelection = info;
  show(positionTrigger(anchor), openCard);
}

/**
 * Where to put the button.
 *
 * A form field has no Range, so its own box is the only anchor available — the
 * same compromise `readFormFieldSelection` makes for the card.
 */
function anchorRect(info: SelectionInfo): DOMRect | null {
  if (info.range) {
    if (!info.range.startContainer.isConnected) return null;
    const rect = info.range.getBoundingClientRect();
    // A collapsed or unrendered range measures as all-zero.
    return rect.width === 0 && rect.height === 0 ? null : rect;
  }

  if (info.element?.isConnected) return info.element.getBoundingClientRect();
  return null;
}

function show(position: CardPosition, openCard: OpenCard): void {
  // `createElement` rather than JSX so this module can stay a `.ts` controller:
  // it exports only functions, and a `.tsx` file that exports no components
  // trips the fast-refresh lint rule for good reason.
  mountSurface('trigger', () =>
    createElement(RewriteTrigger, {
      position,
      shortcut,
      onActivate: () => {
        const selection = currentSelection;
        hide();
        if (selection) openCard(selection);
      },
    }),
  );

  applySurfaceTheme('trigger', theme);
}

function hide(): void {
  currentSelection = null;
  if (isSurfaceMounted('trigger')) unmountSurface('trigger');
}

async function loadTheme(): Promise<void> {
  theme = await loadResolvedTheme();
}

async function loadShortcut(): Promise<void> {
  if (!chrome.commands?.getAll) return;
  try {
    const commands = await chrome.commands.getAll();
    shortcut =
      commands.find((entry) => entry.name === 'improve-writing')?.shortcut ||
      null;
  } catch {
    // Not fatal — the button simply shows no accelerator.
  }
}
