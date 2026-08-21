/**
 * Service worker entry point.
 *
 * Registration only — the work lives in the sibling modules. Nothing here may
 * assume state survives between events: MV3 terminates the worker when idle.
 */

import { loadSettings } from '@/storage/settings';
import type { BackgroundToContentMessage } from '@/shared/types';
import { registerStreamHandler } from './streamHandler';
import { registerModelsBridge } from './modelsBridge';
import { registerLanguageBridge, registerThemeBridge } from './themeBridge';
import { SendOptions, describeDeliveryFailure, sendMessageToTab } from './tabs';

registerStreamHandler();
registerThemeBridge();
registerLanguageBridge();
registerModelsBridge();

/**
 * The one entry point.
 *
 * The inline trigger and the right-click menu both existed and were both
 * removed: this user drives the extension entirely from a mouse macro bound to
 * the shortcut. The action is whichever tab the card was last on, so pressing it
 * reopens where they left off.
 */
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'improve-writing' || !tab?.id) return;

  const tabId = tab.id;
  void loadSettings().then((settings) =>
    // A command carries no frame id. Broadcasting is safe because
    // TRIGGER_REWRITE has no text, so a frame with no live selection does
    // nothing at all.
    deliver(tabId, {
      type: 'TRIGGER_REWRITE',
      action: settings.lastAction,
      language: settings.translateLanguage,
    }),
  );
});

async function deliver(
  tabId: number,
  message: BackgroundToContentMessage,
  options?: SendOptions,
): Promise<void> {
  const result = await sendMessageToTab(tabId, message, options);
  if (!result.ok) {
    console.warn(
      `[Rewrite AI] ${describeDeliveryFailure(result)} (${result.detail})`,
    );
  }
}
