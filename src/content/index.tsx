/**
 * Content script entry point.
 *
 * Note the deliberate absence of React.StrictMode. Its intentional
 * mount → unmount → remount cycle double-invoked the effect that starts a
 * rewrite, producing two billed provider calls per card and two ports whose
 * handlers interleaved their output into one string.
 */

import { backgroundToContentMessageSchema } from '@/background/messages';
import { RewriteCard } from './components/RewriteCard';
import { applySurfaceTheme, mountSurface } from './mount';
import { getEditableSelectionInfo } from './selection';
import { loadResolvedTheme } from './theme';
import { hideInlineTrigger, registerInlineTrigger } from './trigger';
import type { RewriteAction, SelectionInfo } from '@/shared/types';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const parsed = backgroundToContentMessageSchema.safeParse(message);

  // Not ours — return without claiming the response channel, so other
  // listeners can answer. Returning true unconditionally, as this once did,
  // leaves the sender's promise permanently unsettled.
  if (!parsed.success) return undefined;

  // Readiness probe from the worker after it injects this script. Answer before
  // doing anything else so the reply is as cheap and early as possible.
  if (parsed.data.type === 'PING') {
    sendResponse({ status: 'ready' });
    return false;
  }

  try {
    openCardFromSelection(parsed.data.action);
    sendResponse({ status: 'ok' });
  } catch (err: unknown) {
    console.warn('[Rewrite AI] Could not open the rewrite card:', err);
    sendResponse({ status: 'error' });
  }

  // Responded synchronously.
  return false;
});

// The inline offer, Edge's defining interaction.
registerInlineTrigger((selectionInfo) => openCard('improve', selectionInfo));

/**
 * Open the card for whatever is selected now.
 *
 * The context menu passes its own `selectionText`, but it is not used as a
 * fallback any more: without a live, measurable selection there is nothing to
 * write back into, and a card that cannot apply its result is worse than no card.
 */
function openCardFromSelection(action: RewriteAction): void {
  const selectionInfo = getEditableSelectionInfo();
  if (!selectionInfo) return;

  openCard(action, selectionInfo);
}

function openCard(action: RewriteAction, selectionInfo: SelectionInfo): void {
  hideInlineTrigger();

  mountSurface('card', (close) => (
    <RewriteCard
      selectionInfo={selectionInfo}
      initialAction={action}
      onClose={close}
    />
  ));

  // Theme is applied after mount so the card does not flash the wrong palette.
  void loadResolvedTheme().then((theme) => applySurfaceTheme('card', theme));
}
