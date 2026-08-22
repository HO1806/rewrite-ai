/**
 * Content script entry point.
 *
 * Note the deliberate absence of React.StrictMode. Its intentional
 * mount → unmount → remount cycle double-invoked the effect that starts a
 * rewrite, producing two billed provider calls per card and two ports whose
 * handlers interleaved their output into one string.
 *
 * This script is inert until the worker messages it. It used to register a
 * `selectionchange` watcher for the inline trigger, which made it the one part
 * of the extension running continuously on every page of every site; the
 * shortcut is now the only way in, so it listens for nothing else.
 */

import { backgroundToContentMessageSchema } from '@/background/messages';
import { RewriteCard } from './components/RewriteCard';
import { applySurfaceTheme, mountSurface } from './mount';
import { getEditableSelectionInfo } from './selection';
import { loadResolvedTheme } from './theme';
import type { RewriteAction } from '@/shared/types';

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
    openCardFromSelection(parsed.data.action, parsed.data.language);
    sendResponse({ status: 'ok' });
  } catch (err: unknown) {
    console.warn('[Rewrite AI] Could not open the rewrite card:', err);
    sendResponse({ status: 'error' });
  }

  // Responded synchronously.
  return false;
});

/**
 * Open the card for whatever is selected now.
 *
 * Without a live, measurable selection there is nothing to write a result back
 * into, and a card that cannot apply its result is worse than no card.
 */
function openCardFromSelection(action: RewriteAction, language: string): void {
  const selectionInfo = getEditableSelectionInfo();
  if (!selectionInfo) return;

  mountSurface('card', (close) => (
    <RewriteCard
      selectionInfo={selectionInfo}
      initialAction={action}
      initialLanguage={language}
      onClose={close}
      onLanguageChange={saveLanguage}
    />
  ));

  // Theme is applied after mount so the card does not flash the wrong palette.
  void loadResolvedTheme().then((theme) => applySurfaceTheme('card', theme));
}

/**
 * Hands the chosen language to the worker, which owns settings storage.
 *
 * Awaited by the card before it re-runs the translation: the worker reads the
 * stored language when building the prompt, so a re-run that starts first gets
 * the previous language. A failed write is not worth blocking the rewrite over —
 * the card keeps using the chosen language for this session either way — but it
 * is reported rather than swallowed.
 */
async function saveLanguage(language: string): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'SET_LANGUAGE', language });
  } catch (err: unknown) {
    console.warn('[Rewrite AI] Could not save the language preference:', err);
  }
}
