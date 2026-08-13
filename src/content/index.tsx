/**
 * Content script entry point.
 *
 * Note the deliberate absence of React.StrictMode. Its intentional
 * mount → unmount → remount cycle double-invoked the effect that starts a
 * rewrite, producing two billed provider calls per card and two ports whose
 * handlers interleaved their output into one string.
 */

import { backgroundToContentMessageSchema } from '@/background/messages';
import { resolveTheme } from '@/shared/theme';
import { loadSettings } from '@/storage/settings';
import { RewriteCard } from './components/RewriteCard';
import { applyCardTheme, mountCard } from './mount';
import { getSelectionInfo } from './selection';
import { CARD } from '@/shared/constants';
import type { RewriteAction, SelectionInfo } from '@/shared/types';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const parsed = backgroundToContentMessageSchema.safeParse(message);

  // Not ours — return without claiming the response channel, so other
  // listeners can answer. Returning true unconditionally, as this once did,
  // leaves the sender's promise permanently unsettled.
  if (!parsed.success) return undefined;

  try {
    const { type, action } = parsed.data;
    openCard(action, type === 'REWRITE_REQUEST' ? parsed.data.text : undefined);
    sendResponse({ status: 'ok' });
  } catch (err: unknown) {
    console.warn('[Rewrite AI] Could not open the rewrite card:', err);
    sendResponse({ status: 'error' });
  }

  // Responded synchronously.
  return false;
});

function openCard(action: RewriteAction, contextMenuText?: string): void {
  const selectionInfo = buildSelectionInfo(contextMenuText);
  if (!selectionInfo) return;

  mountCard((close) => (
    <RewriteCard
      selectionInfo={selectionInfo}
      initialAction={action}
      onClose={close}
    />
  ));

  // Theme is applied after mount so the card does not flash the wrong palette.
  void loadSettings()
    .then((settings) => applyCardTheme(resolveTheme(settings.theme)))
    .catch(() => applyCardTheme('dark'));
}

/**
 * Resolve what to rewrite.
 *
 * The live selection is preferred; the context menu's `selectionText` is a
 * fallback for the cases where the browser has already cleared it.
 */
function buildSelectionInfo(contextMenuText?: string): SelectionInfo | null {
  const live = getSelectionInfo();

  if (live) {
    // Trust the live selection's text unless the menu passed something longer
    // (the browser truncates neither, but they can disagree across frames).
    return contextMenuText && !live.text
      ? { ...live, text: contextMenuText }
      : live;
  }

  if (!contextMenuText) return null;

  // No measurable selection in this frame: centre the card horizontally rather
  // than pinning it to a hardcoded 100,100 in the top-left corner.
  return {
    text: contextMenuText,
    range: null,
    element: null,
    elementType: 'unknown',
    position: {
      top: CARD.margin * 4,
      left: Math.max(CARD.margin, (window.innerWidth - CARD.width) / 2),
    },
  };
}
