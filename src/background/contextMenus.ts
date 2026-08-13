/**
 * Context menu registration.
 *
 * Registration is bound to `onInstalled` and `onStartup` only. It used to also
 * run as a bare top-level call, which meant it re-ran on every service-worker
 * wake and, on install, raced the onInstalled listener: two interleaved
 * removeAll/create sequences, the second failing with a duplicate-id error that
 * nothing observed because `chrome.runtime.lastError` was never checked.
 */

import { ACTIONS } from '@/shared/constants';

const PARENT_ID = 'rewrite-ai-parent';

export function registerContextMenus(): void {
  chrome.runtime.onInstalled.addListener(() => {
    void rebuildContextMenus();
  });
  chrome.runtime.onStartup.addListener(() => {
    void rebuildContextMenus();
  });
}

export async function rebuildContextMenus(): Promise<void> {
  await removeAllMenus();

  await createMenu({
    id: PARENT_ID,
    title: 'Rewrite AI',
    contexts: ['selection'],
  });

  for (const action of ACTIONS) {
    await createMenu({
      id: action.id,
      parentId: PARENT_ID,
      title: action.label,
      contexts: ['selection'],
    });
  }
}

function removeAllMenus(): Promise<void> {
  return new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      // Nothing to recover from — a failed removal is followed by creates that
      // will surface their own duplicate-id errors.
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function createMenu(
  properties: chrome.contextMenus.CreateProperties,
): Promise<void> {
  return new Promise((resolve) => {
    chrome.contextMenus.create(properties, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        console.warn(
          `[Rewrite AI] Could not create menu "${properties.id}": ${error.message}`,
        );
      }
      resolve();
    });
  });
}
