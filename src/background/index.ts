/**
 * Service worker entry point.
 *
 * Registration only — the work lives in the sibling modules. Nothing here may
 * assume state survives between events: MV3 terminates the worker when idle.
 */

import { ACTIONS } from '@/shared/constants';
import type { RewriteAction } from '@/shared/types';
import { registerContextMenus } from './contextMenus';
import { registerStreamHandler } from './streamHandler';
import { describeDeliveryFailure, sendMessageToTab } from './tabs';

registerContextMenus();
registerStreamHandler();

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || !info.selectionText) return;

  const action = toRewriteAction(info.menuItemId);
  if (!action) return;

  void deliver(tab.id, {
    type: 'REWRITE_REQUEST',
    action,
    text: info.selectionText,
  });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'improve-writing' || !tab?.id) return;

  void deliver(tab.id, { type: 'TRIGGER_REWRITE', action: 'improve' });
});

async function deliver(
  tabId: number,
  message: Parameters<typeof sendMessageToTab>[1],
): Promise<void> {
  const result = await sendMessageToTab(tabId, message);
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
