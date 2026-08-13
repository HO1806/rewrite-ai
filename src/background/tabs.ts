/**
 * Messaging into tabs, with content-script recovery.
 *
 * A tab that was already open when the extension was installed or reloaded has
 * no content script, so the first message fails. The previous recovery attempt
 * hardcoded a Vite content-hash (`assets/index.tsx-loader-CTsBxEuS.js`) which no
 * longer matched what the build emitted — and since the hash is derived from file
 * content, no committed literal ever could. It also never resent the message
 * afterwards, and swallowed the failure at three separate levels.
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

export async function sendMessageToTab(
  tabId: number,
  message: BackgroundToContentMessage,
): Promise<DeliveryResult> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return { ok: true };
  } catch (err: unknown) {
    const injected = await injectContentScript(tabId);
    if (!injected.ok) return injected;

    // Inject-then-resend: without this the user's click is simply dropped.
    try {
      await chrome.tabs.sendMessage(tabId, message);
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
