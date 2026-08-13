/**
 * Answers the content script's request for the user's theme preference.
 *
 * Exists so the content script never has to read the settings object, which
 * carries the API key. Only the `theme` enum crosses the boundary; resolving
 * `'system'` needs `window.matchMedia`, which a service worker does not have, so
 * that last step happens on the content side.
 */

import { loadSettings } from '@/storage/settings';
import { themeRequestSchema } from './messages';

export function registerThemeBridge(): void {
  chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
    if (!themeRequestSchema.safeParse(raw).success) return undefined;

    loadSettings()
      .then((settings) => sendResponse({ theme: settings.theme }))
      .catch(() => sendResponse({ theme: 'system' }));

    // Replying asynchronously, so the channel has to stay open.
    return true;
  });
}
