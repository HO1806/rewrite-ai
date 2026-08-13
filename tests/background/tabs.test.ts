import { describe, expect, it } from 'vitest';
import { describeDeliveryFailure, sendMessageToTab } from '@/background/tabs';
import type { BackgroundToContentMessage } from '@/shared/types';
import { chromeMock } from '../setup';

const MESSAGE: BackgroundToContentMessage = {
  type: 'REWRITE_REQUEST',
  action: 'improve',
  text: 'hello',
};

describe('sendMessageToTab', () => {
  it('delivers to a tab that already has the content script', async () => {
    await expect(sendMessageToTab(7, MESSAGE)).resolves.toEqual({ ok: true });
    expect(chromeMock.sentTabMessages).toEqual([
      { tabId: 7, message: MESSAGE },
    ]);
    expect(chromeMock.executedScripts).toHaveLength(0);
  });

  /**
   * The recovery path. It previously injected a hardcoded Vite content-hash that
   * no longer matched the build, and never resent the message afterwards — so a
   * right-click on a pre-existing tab did nothing, silently.
   */
  it('injects the content script and resends when the first attempt fails', async () => {
    chromeMock.tabMessageError = 'Receiving end does not exist';

    const promise = sendMessageToTab(7, MESSAGE);
    // Let the injection succeed, then allow the resend to land.
    chromeMock.executeScriptError = null;
    queueMicrotask(() => {
      chromeMock.tabMessageError = null;
    });

    await expect(promise).resolves.toEqual({ ok: true });
    expect(chromeMock.executedScripts).toHaveLength(1);
    expect(chromeMock.sentTabMessages).toEqual([
      { tabId: 7, message: MESSAGE },
    ]);
  });

  /** Reads the path from the manifest, so a rebuild cannot invalidate it. */
  it('injects the paths declared in the manifest, in all frames', async () => {
    chromeMock.tabMessageError = 'Receiving end does not exist';

    await sendMessageToTab(7, MESSAGE);

    expect(chromeMock.executedScripts[0]).toMatchObject({
      target: { tabId: 7, allFrames: true },
      files: ['src/content/index.tsx'],
    });
  });

  it('reports a restricted page distinctly', async () => {
    chromeMock.tabMessageError = 'Receiving end does not exist';
    chromeMock.executeScriptError = 'Cannot access a chrome:// URL';

    const result = await sendMessageToTab(7, MESSAGE);
    expect(result).toMatchObject({ ok: false, reason: 'restricted-page' });
  });

  it('reports an unknown injection failure', async () => {
    chromeMock.tabMessageError = 'Receiving end does not exist';
    chromeMock.executeScriptError = 'something else broke';

    const result = await sendMessageToTab(7, MESSAGE);
    expect(result).toMatchObject({ ok: false, reason: 'unknown' });
  });

  it('reports a failure when the resend also fails', async () => {
    chromeMock.tabMessageError = 'Receiving end does not exist';

    const result = await sendMessageToTab(7, MESSAGE);
    expect(result).toMatchObject({ ok: false, reason: 'unknown' });
    expect(chromeMock.executedScripts).toHaveLength(1);
  });

  it('reports a manifest with no content scripts', async () => {
    chromeMock.tabMessageError = 'Receiving end does not exist';
    chromeMock.manifest = { ...chromeMock.manifest, content_scripts: [] };

    const result = await sendMessageToTab(7, MESSAGE);
    expect(result).toMatchObject({ ok: false, reason: 'no-content-script' });
  });
});

describe('describeDeliveryFailure', () => {
  it.each([
    ['restricted-page', /cannot run on this page/i],
    ['unknown', /reload the page/i],
    ['no-content-script', /reload the page/i],
  ] as const)('explains %s', (reason, pattern) => {
    expect(describeDeliveryFailure({ ok: false, reason, detail: 'x' })).toMatch(
      pattern,
    );
  });
});
