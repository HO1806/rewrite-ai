/**
 * Messaging into tabs, with content-script recovery.
 *
 * A tab that was already open when the extension was installed or reloaded has
 * no content script, so the first message fails and one has to be injected.
 *
 * The subtle part is that **injection completing does not mean the script is
 * listening.** The bundler emits a tiny loader that fires off a dynamic
 * `import()` of the real module and returns immediately:
 *
 *     (function () {
 *       (async () => {
 *         const { onExecute } = await import(chrome.runtime.getURL("assets/…js"));
 *         onExecute?.({ … });
 *       })().catch(console.error);
 *     })();
 *
 * `chrome.scripting.executeScript` resolves when that IIFE returns — microseconds
 * later, while a ~225 KB module graph is still loading. `onMessage` is registered
 * at the top level of the imported chunk, so sending the real message straight
 * afterwards loses the race essentially every time and the user's click is
 * silently dropped. So we poll a cheap PING until the script answers, and only
 * then deliver. Polling PING rather than retrying the real message matters: a
 * retried rewrite could land twice and mount duplicate cards.
 */

import type { BackgroundToContentMessage } from '@/shared/types';
import { getErrorMessage } from '@/shared/errors';

export type DeliveryResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'no-content-script' | 'restricted-page' | 'unknown';
      detail: string;
    };

export interface SendOptions {
  /**
   * Deliver to one frame only. The context menu reports which frame the
   * selection is in; without it every frame in the tab receives the message,
   * and each one that cannot find a selection opens its own card and bills its
   * own request.
   */
  frameId?: number;
}

/** Readiness polling: ~1.5s total, backing off so a fast script costs one probe. */
const PING_DELAYS_MS = [0, 25, 50, 100, 150, 250, 400, 500];

export async function sendMessageToTab(
  tabId: number,
  message: BackgroundToContentMessage,
  options: SendOptions = {},
): Promise<DeliveryResult> {
  const target =
    options.frameId === undefined ? undefined : { frameId: options.frameId };

  try {
    await dispatch(tabId, message, target);
    return { ok: true };
  } catch (err: unknown) {
    const injected = await injectContentScript(tabId);
    if (!injected.ok) return injected;

    const ready = await waitForContentScript(tabId, target);
    if (!ready) {
      return {
        ok: false,
        reason: 'unknown',
        detail: `${getErrorMessage(err)} / content script did not respond after injection`,
      };
    }

    try {
      await dispatch(tabId, message, target);
      return { ok: true };
    } catch (resendErr: unknown) {
      return {
        ok: false,
        reason: 'unknown',
        detail: `${getErrorMessage(err)} / ${getErrorMessage(resendErr)}`,
      };
    }
  }
}

function dispatch(
  tabId: number,
  message: BackgroundToContentMessage,
  target: { frameId: number } | undefined,
): Promise<unknown> {
  return target
    ? chrome.tabs.sendMessage(tabId, message, target)
    : chrome.tabs.sendMessage(tabId, message);
}

/** Poll PING until the freshly injected script answers, or give up. */
async function waitForContentScript(
  tabId: number,
  target: { frameId: number } | undefined,
): Promise<boolean> {
  for (const delay of PING_DELAYS_MS) {
    if (delay > 0) await sleep(delay);
    try {
      await dispatch(tabId, { type: 'PING' }, target);
      return true;
    } catch {
      // Not listening yet; keep waiting.
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Inject the content script into a tab that is missing it.
 *
 * The script paths are read from the manifest at runtime, so they stay correct
 * across rebuilds regardless of how the bundler names its chunks.
 */
async function injectContentScript(tabId: number): Promise<DeliveryResult> {
  const files = contentScriptFiles();

  if (files.length === 0) {
    return {
      ok: false,
      reason: 'no-content-script',
      detail: 'No content scripts are declared in the manifest.',
    };
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files,
    });
    return { ok: true };
  } catch (err: unknown) {
    const detail = getErrorMessage(err);
    // chrome://, the Web Store and PDF viewers cannot be scripted at all.
    const restricted =
      /cannot be scripted|chrome:\/\/|extension pages|showing error page/i.test(
        detail,
      );
    return {
      ok: false,
      reason: restricted ? 'restricted-page' : 'unknown',
      detail,
    };
  }
}

function contentScriptFiles(): string[] {
  const declared = chrome.runtime.getManifest().content_scripts ?? [];
  return declared.flatMap((entry) => entry.js ?? []);
}

/** Message a user would understand for a failed delivery. */
export function describeDeliveryFailure(
  result: Extract<DeliveryResult, { ok: false }>,
): string {
  switch (result.reason) {
    case 'restricted-page':
      return 'Rewrite AI cannot run on this page.';
    case 'no-content-script':
    case 'unknown':
      return 'Rewrite AI could not attach to this tab. Reload the page and try again.';
  }
}
