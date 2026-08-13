/**
 * Content-script message routing.
 *
 * The listener is registered at import time, so each test imports the module
 * fresh and then drives the listener the background worker would have called.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerStreamHandler } from '@/background/streamHandler';
import { registerThemeBridge } from '@/background/themeBridge';
import { DEFAULT_SETTINGS, SHADOW_HOST_ID } from '@/shared/constants';
import { saveSettings, settingsSchema } from '@/storage/settings';
import { unmountSurface } from '@/content/mount';
import { chromeMock } from '../setup';
import { sseResponse, stubFetchEach } from '../helpers/http';

type MessageListener = (
  message: unknown,
  sender: unknown,
  respond: (value?: unknown) => void,
) => unknown;

async function loadContentScript(): Promise<MessageListener> {
  vi.resetModules();
  await import('@/content/index');

  const listener = chromeMock.listeners.message.at(-1);
  if (!listener)
    throw new Error('The content script registered no message listener.');
  return listener as MessageListener;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function host(): HTMLElement | null {
  return document.getElementById(SHADOW_HOST_ID);
}

function cardText(): string {
  return host()?.shadowRoot?.textContent ?? '';
}

beforeEach(async () => {
  document.body.innerHTML = '';
  registerStreamHandler();
  registerThemeBridge();
  stubFetchEach(() => sseResponse(['data: [DONE]']));
  await saveSettings(
    settingsSchema.parse({ ...DEFAULT_SETTINGS, apiKey: 'sk-test' }),
  );
});

afterEach(async () => {
  unmountSurface('card');
  await settle();
  document.body.innerHTML = '';
});

/** A focused textarea with a selection — the only thing that opens a card now. */
function selectInTextarea(
  value = 'their going to the meating',
): HTMLTextAreaElement {
  const textarea = document.createElement('textarea');
  textarea.value = value;
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.setSelectionRange(0, value.length);
  return textarea;
}

describe('REWRITE_REQUEST', () => {
  it('opens the card for a selection in an editable field', async () => {
    selectInTextarea();
    const listener = await loadContentScript();
    const respond = vi.fn();

    listener(
      { type: 'REWRITE_REQUEST', action: 'improve', text: 'fix me' },
      {},
      respond,
    );
    await settle();

    expect(respond).toHaveBeenCalledWith({ status: 'ok' });
    expect(cardText()).toContain('Here is another way of writing this');
  });

  it('uses the action from the message', async () => {
    selectInTextarea();
    const listener = await loadContentScript();

    listener(
      { type: 'REWRITE_REQUEST', action: 'translate', text: 'hola' },
      {},
      vi.fn(),
    );
    await settle();

    expect(cardText()).toContain('Here is the translation');
  });

  /**
   * Matching Edge, the feature is offered only where it can write back. A card
   * that opens over read-only text can only fall back to a clipboard copy and
   * relabel itself "Copied instead" — a confusing thing to discover after the
   * fact, so it no longer opens at all.
   */
  it('does not open for a selection that cannot be written back to', async () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = 'read-only article text';
    document.body.appendChild(paragraph);

    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const listener = await loadContentScript();
    const respond = vi.fn();

    listener(
      {
        type: 'REWRITE_REQUEST',
        action: 'improve',
        text: 'read-only article text',
      },
      {},
      respond,
    );
    await settle();

    expect(host()).toBeNull();
    expect(respond).toHaveBeenCalledWith({ status: 'ok' });
  });

  it('does not open when the context menu supplies text but nothing is selected', async () => {
    const listener = await loadContentScript();

    listener(
      { type: 'REWRITE_REQUEST', action: 'improve', text: 'from the menu' },
      {},
      vi.fn(),
    );
    await settle();

    expect(host()).toBeNull();
  });

  it('rewrites the live selection, not the text the menu passed', async () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'live selection text';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.setSelectionRange(0, 4);

    const calls = stubFetchEach(() => sseResponse(['data: [DONE]']));
    const listener = await loadContentScript();

    listener(
      { type: 'REWRITE_REQUEST', action: 'improve', text: 'menu text' },
      {},
      vi.fn(),
    );

    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(String(calls[0]!.init.body)).toContain('live');
    expect(String(calls[0]!.init.body)).not.toContain('menu text');
  });
});

describe('TRIGGER_REWRITE', () => {
  it('opens the card from the live selection', async () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'keyboard triggered';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.setSelectionRange(0, 8);

    const listener = await loadContentScript();
    const respond = vi.fn();

    listener({ type: 'TRIGGER_REWRITE', action: 'improve' }, {}, respond);
    await settle();

    expect(respond).toHaveBeenCalledWith({ status: 'ok' });
    expect(host()).not.toBeNull();
  });

  it('does nothing when there is no selection at all', async () => {
    const listener = await loadContentScript();

    listener({ type: 'TRIGGER_REWRITE', action: 'improve' }, {}, vi.fn());
    await settle();

    expect(host()).toBeNull();
  });
});

describe('message validation', () => {
  /**
   * An unrecognised message must not claim the response channel. Returning true
   * unconditionally, as this once did, leaves the sender's promise unsettled.
   */
  it.each([
    ['an unknown type', { type: 'SOMETHING_ELSE' }],
    [
      'an unknown action',
      { type: 'REWRITE_REQUEST', action: 'destroy', text: 'x' },
    ],
    ['a missing text field', { type: 'REWRITE_REQUEST', action: 'improve' }],
    ['a null payload', null],
    ['a bare string', 'REWRITE_REQUEST'],
  ])('ignores %s without responding', async (_label, payload) => {
    const listener = await loadContentScript();
    const respond = vi.fn();

    const result = listener(payload, {}, respond);
    await settle();

    expect(result).toBeUndefined();
    expect(respond).not.toHaveBeenCalled();
    expect(host()).toBeNull();
  });

  it('returns false for a handled message, having answered synchronously', async () => {
    selectInTextarea();
    const listener = await loadContentScript();

    const result = listener(
      { type: 'REWRITE_REQUEST', action: 'improve', text: 'x' },
      {},
      vi.fn(),
    );
    await settle();

    expect(result).toBe(false);
  });
});

describe('theming', () => {
  it('applies the stored theme to the shadow host', async () => {
    await saveSettings(
      settingsSchema.parse({
        ...DEFAULT_SETTINGS,
        apiKey: 'sk-test',
        theme: 'light',
      }),
    );
    selectInTextarea();
    const listener = await loadContentScript();

    listener(
      { type: 'REWRITE_REQUEST', action: 'improve', text: 'x' },
      {},
      vi.fn(),
    );
    await settle();

    expect(host()!.getAttribute('data-theme')).toBe('light');
  });

  it('falls back to the dark palette when the worker cannot be reached', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The content script asks the worker for the theme rather than reading
    // settings itself, so this is the failure that matters.
    chromeMock.runtimeMessageError = 'Could not establish connection.';
    selectInTextarea();
    const listener = await loadContentScript();

    listener(
      { type: 'REWRITE_REQUEST', action: 'improve', text: 'x' },
      {},
      vi.fn(),
    );
    await settle();

    expect(host()!.getAttribute('data-theme')).toBe('dark');
  });
});
