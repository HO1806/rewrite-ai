/**
 * Context menu registration.
 *
 * Two things here are load-bearing, and both were learned by watching the
 * extension fail in a browser rather than by reasoning about it.
 *
 * **Rebuilds are serialized.** A rebuild removes every item, creates the parent,
 * then creates seven children — eight awaited round trips. If a second rebuild
 * starts partway through, its `removeAll()` deletes the parent between the first
 * rebuild's parent-create and its children, and all seven children fail with
 * "Cannot find menu item with id rewrite-ai-parent". The result is no context
 * menu at all plus seven errors on the extension card. That is reachable when
 * `onInstalled` and `onStartup` both fire (a Chrome update at browser start) and
 * whenever the user hits Reload on the extension card while a rebuild is in
 * flight — which is exactly what someone does when the extension seems broken.
 *
 * **Registration is not a bare top-level call.** It used to be, which re-ran on
 * every service-worker wake and raced the install handler in the same way.
 */

import { ACTIONS } from '@/shared/constants';

const PARENT_ID = 'rewrite-ai-parent';

/**
 * Editable contexts only, matching Edge — every rewrite the menu offers can then
 * actually be written back.
 *
 * Chrome cannot AND two contexts, so `['editable']` is the closest available
 * match to "an editable field with something selected". The tradeoff is that the
 * submenu is now visible in a text field even with nothing selected; the click
 * handler still requires `info.selectionText`, so it does nothing in that case.
 */
const MENU_CONTEXTS: chrome.contextMenus.ContextType[] = ['editable'];

/** Tail of the rebuild queue. Concurrent callers chain rather than interleave. */
let pending: Promise<void> = Promise.resolve();

export function registerContextMenus(): void {
  chrome.runtime.onInstalled.addListener(() => {
    void rebuildContextMenus();
  });
  chrome.runtime.onStartup.addListener(() => {
    void rebuildContextMenus();
  });
}

/** Rebuild the menu, queued behind any rebuild already running. */
export function rebuildContextMenus(): Promise<void> {
  pending = pending.then(build, build);
  return pending;
}

async function build(): Promise<void> {
  await removeAllMenus();

  const parentCreated = await createMenu({
    id: PARENT_ID,
    title: 'Rewrite AI',
    contexts: MENU_CONTEXTS,
  });

  // Without the parent every child fails with "Cannot find menu item". Report
  // that once instead of seven times, and say something actionable.
  if (!parentCreated) {
    console.error(
      '[Rewrite AI] Could not create the context menu. Reload the extension from chrome://extensions.',
    );
    return;
  }

  for (const action of ACTIONS) {
    await createMenu({
      id: action.id,
      parentId: PARENT_ID,
      title: action.label,
      contexts: MENU_CONTEXTS,
    });
  }
}

function removeAllMenus(): Promise<void> {
  return new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      // Read to consume it; a failed removal is followed by creates that report
      // their own errors.
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

/** Resolves true when the item exists. */
function createMenu(
  properties: chrome.contextMenus.CreateProperties,
): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.contextMenus.create(properties, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        console.warn(
          `[Rewrite AI] Could not create menu "${properties.id}": ${error.message}`,
        );
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}
