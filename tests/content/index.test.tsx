/**
 * Content-script message routing.
 *
 * The listener is registered at import time, so each test imports the module
 * fresh and then drives the listener the background worker would have called.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerStreamHandler } from '@/background/streamHandler';
import { CARD, DEFAULT_SETTINGS, SHADOW_HOST_ID } from '@/shared/constants';
import { saveSettings, settingsSchema } from '@/storage/settings';
import { unmountCard } from '@/content/mount';
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
  stubFetchEach(() => sseResponse(['data: [DONE]']));
  await saveSettings(
    settingsSchema.parse({ ...DEFAULT_SETTINGS, apiKey: 'sk-test' }),
  );
});

afterEach(async () => {
  unmountCard();
  await settle();
  document.body.innerHTML = '';
});

describe('REWRITE_REQUEST', () => {
  it('opens the card with the text the context menu supplied', async () => {
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
   * When the selection is unmeasurable in this frame the card is centred rather
   * than pinned to a hardcoded 100,100 in the top-left corner.
   */
  it('centres the card when there is no measurable selection', async () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 1200,
      configurable: true,
    });
    const listener = await loadContentScript();

    listener(
      { type: 'REWRITE_REQUEST', action: 'improve', text: 'from the menu' },
      {},
      vi.fn(),
    );
    await settle();

    const card = host()!.shadowRoot!.querySelector<HTMLElement>('.card')!;
    expect(card.style.left).toBe(`${(1200 - CARD.width) / 2}px`);
  });

  it('prefers a live selection over the menu text', async () => {
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
    const listener = await loadContentScript();

    listener(
      { type: 'REWRITE_REQUEST', action: 'improve', text: 'x' },
      {},
      vi.fn(),
    );
    await settle();

    expect(host()!.getAttribute('data-theme')).toBe('light');
  });

  it('falls back to the dark palette when settings cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(
      new Error('storage unavailable'),
    );
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
