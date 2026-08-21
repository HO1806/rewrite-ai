import { describe, expect, it } from 'vitest';
import { describeDeliveryFailure, sendMessageToTab } from '@/background/tabs';
import type { BackgroundToContentMessage } from '@/shared/types';
import { chromeMock } from '../setup';

const MESSAGE: BackgroundToContentMessage = {
  type: 'TRIGGER_REWRITE',
  action: 'improve',
  language: 'English',
};

describe('sendMessageToTab', () => {
  it('delivers to a tab that already has the content script', async () => {
    await expect(sendMessageToTab(7, MESSAGE)).resolves.toEqual({ ok: true });
    expect(chromeMock.sentTabMessages).toEqual([
      { tabId: 7, message: MESSAGE, frameId: undefined },
    ]);
    expect(chromeMock.executedScripts).toHaveLength(0);
  });

  it('delivers to a single frame when one is named', async () => {
    await expect(sendMessageToTab(7, MESSAGE, { frameId: 3 })).resolves.toEqual(
      { ok: true },
    );
    expect(chromeMock.sentTabMessages).toEqual([
      { tabId: 7, message: MESSAGE, frameId: 3 },
    ]);
  });

  /**
   * The regression that made the extension look dead. `executeScript` resolves
   * as soon as the bundler's loader IIFE returns, while its dynamic import of
   * the real module — and therefore the `onMessage` registration — is still
   * pending. The old code resent immediately and lost that race every time.
   */
  it('waits for the content script to answer before delivering', async () => {
    // Injection lands, but the script only starts answering on the 4th attempt.
    chromeMock.attemptsUntilContentScriptReady = 4;

    await expect(sendMessageToTab(7, MESSAGE)).resolves.toEqual({ ok: true });

    expect(chromeMock.executedScripts).toHaveLength(1);
    // A PING got through first, then the rewrite — and the rewrite is last, so it
    // was never sent while the script was still unreachable.
    expect(
      chromeMock.sentTabMessages.map(
        (entry) => (entry.message as { type: string }).type,
      ),
    ).toEqual(['PING', 'TRIGGER_REWRITE']);
  });

  /** A retried rewrite could mount duplicate cards, so probing uses PING. */
  it('probes with PING rather than repeating the rewrite', async () => {
    chromeMock.attemptsUntilContentScriptReady = 3;

    await sendMessageToTab(7, MESSAGE);

    const rewrites = chromeMock.sentTabMessages.filter(
      (entry) => (entry.message as { type: string }).type === 'TRIGGER_REWRITE',
    );
    expect(rewrites).toHaveLength(1);
  });

  /** Reads the path from the manifest, so a rebuild cannot invalidate it. */
  it('injects the paths declared in the manifest, in all frames', async () => {
    chromeMock.attemptsUntilContentScriptReady = 2;

    await sendMessageToTab(7, MESSAGE);

    expect(chromeMock.executedScripts[0]).toMatchObject({
      target: { tabId: 7, allFrames: true },
      files: ['assets/index.tsx-loader-abc123.js'],
    });
  });

  it('gives up when the content script never answers', async () => {
    chromeMock.tabMessageError = 'Receiving end does not exist';

    const result = await sendMessageToTab(7, MESSAGE);

    expect(result).toMatchObject({ ok: false, reason: 'unknown' });
    expect(result).toHaveProperty(
      'detail',
      expect.stringContaining('did not respond'),
    );
    expect(chromeMock.executedScripts).toHaveLength(1);
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
