/**
 * Service worker entry point.
 *
 * Registration only — the work lives in the sibling modules. Nothing here may
 * assume state survives between events: MV3 terminates the worker when idle.
 */

import { ACTIONS } from '@/shared/constants';
import type { BackgroundToContentMessage, RewriteAction } from '@/shared/types';
import { registerContextMenus } from './contextMenus';
import { registerStreamHandler } from './streamHandler';
import { registerThemeBridge } from './themeBridge';
import { SendOptions, describeDeliveryFailure, sendMessageToTab } from './tabs';

registerContextMenus();
registerStreamHandler();
registerThemeBridge();

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || !info.selectionText) return;

  const action = toRewriteAction(info.menuItemId);
  if (!action) return;

  // Deliver to the frame the selection is actually in. Broadcasting to the tab
  // means every frame receives it, and each frame without a selection opens its
  // own card and bills its own request — nine of them on an ad-heavy page.
  void deliver(
    tab.id,
    { type: 'REWRITE_REQUEST', action, text: info.selectionText },
    { frameId: info.frameId },
  );
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'improve-writing' || !tab?.id) return;

  // A command carries no frame id. Broadcasting is safe here because
  // TRIGGER_REWRITE has no text, so a frame with no live selection does nothing.
  void deliver(tab.id, { type: 'TRIGGER_REWRITE', action: 'improve' });
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

/** `menuItemId` is typed `string | number`, so it is checked rather than cast. */
function toRewriteAction(menuItemId: string | number): RewriteAction | null {
  const match = ACTIONS.find((action) => action.id === menuItemId);
  return match ? match.id : null;
}
