/**
 * The inline rewrite offer.
 *
 * This is the interaction that makes Edge's version feel native — it offers
 * itself the moment you select text, rather than waiting to be found in a
 * context menu. It must appear only where the result can actually be written
 * back, and it must never appear over read-only page text.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRIGGER_HOST_ID } from '@/shared/constants';
import { registerInlineTrigger, hideInlineTrigger } from '@/content/trigger';
import { unmountSurface } from '@/content/mount';

/**
 * The watcher coalesces into an animation frame, and React 18 schedules its
 * render rather than running it inline, so both need to drain.
 */
async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  }
}

function trigger(): HTMLElement | null {
  return document.getElementById(TRIGGER_HOST_ID);
}

function triggerButton(): HTMLButtonElement | null {
  return (
    trigger()?.shadowRoot?.querySelector<HTMLButtonElement>('.trigger') ?? null
  );
}

/** Nudge the watcher the way a real selection gesture would. */
async function selectionChanged(): Promise<void> {
  document.dispatchEvent(new Event('selectionchange'));
  await settle();
}

function selectInTextarea(
  value = 'their going to the meating',
): HTMLTextAreaElement {
  const field = document.createElement('textarea');
  field.value = value;
  document.body.appendChild(field);
  field.focus();
  field.setSelectionRange(0, value.length);
  return field;
}

function selectContents(element: Element): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

let openCard: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
  openCard = vi.fn();

  // jsdom measures every range as all-zero, which the watcher treats as
  // unanchorable. Give ranges a real box so the geometry path is exercised.
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 100,
    bottom: 120,
    left: 40,
    right: 200,
    width: 160,
    height: 20,
    x: 40,
    y: 100,
    toJSON: () => ({}),
  } as DOMRect);

  registerInlineTrigger(openCard);
});

afterEach(async () => {
  hideInlineTrigger();
  unmountSurface('trigger');
  await settle();
  document.body.innerHTML = '';
});

describe('appears for editable selections', () => {
  it('shows for a selection in a textarea', async () => {
    selectInTextarea();
    await selectionChanged();

    expect(triggerButton()).not.toBeNull();
    expect(triggerButton()!.textContent).toContain('Rewrite');
  });

  it('shows for a selection in a text input', async () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = 'recieve the pakage';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(0, 7);

    await selectionChanged();
    expect(triggerButton()).not.toBeNull();
  });

  it('shows for a selection in a contenteditable', async () => {
    const host = document.createElement('div');
    host.setAttribute('contenteditable', 'true');
    Object.defineProperty(host, 'isContentEditable', {
      value: true,
      configurable: true,
    });
    host.textContent = 'editable prose';
    document.body.appendChild(host);
    selectContents(host);

    await selectionChanged();
    expect(triggerButton()).not.toBeNull();
  });

  it('is positioned in viewport coordinates below the selection', async () => {
    selectInTextarea();
    vi.spyOn(
      HTMLTextAreaElement.prototype,
      'getBoundingClientRect',
    ).mockReturnValue({
      top: 200,
      bottom: 240,
      left: 60,
      right: 300,
      width: 240,
      height: 40,
      x: 60,
      y: 200,
      toJSON: () => ({}),
    } as DOMRect);

    await selectionChanged();

    const button = triggerButton()!;
    expect(button.style.top).toBe('246px');
    expect(button.style.left).toBe('60px');
  });
});

describe('stays hidden where a rewrite could not be applied', () => {
  /** The whole point of the editable-only scope. */
  it('does not show for read-only page text', async () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = 'read-only article text';
    document.body.appendChild(paragraph);
    selectContents(paragraph);

    await selectionChanged();
    expect(trigger()).toBeNull();
  });

  it('does not show for a collapsed caret', async () => {
    const field = document.createElement('textarea');
    field.value = 'nothing selected';
    document.body.appendChild(field);
    field.focus();
    field.setSelectionRange(4, 4);

    await selectionChanged();
    expect(trigger()).toBeNull();
  });

  /** These types throw on the selection APIs, so they are filtered upstream. */
  it.each(['email', 'number', 'checkbox'])(
    'does not show for input[type=%s]',
    async (type) => {
      const input = document.createElement('input');
      input.type = type;
      document.body.appendChild(input);
      input.focus();

      await selectionChanged();
      expect(trigger()).toBeNull();
    },
  );

  it('does not show when nothing is selected at all', async () => {
    await selectionChanged();
    expect(trigger()).toBeNull();
  });
});

describe('dismissal', () => {
  it('hides once the selection collapses', async () => {
    const field = selectInTextarea();
    await selectionChanged();
    expect(trigger()).not.toBeNull();

    field.setSelectionRange(0, 0);
    await selectionChanged();

    expect(trigger()).toBeNull();
  });

  it('hides on Escape without disturbing the page', async () => {
    selectInTextarea();
    await selectionChanged();
    expect(trigger()).not.toBeNull();

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await settle();

    expect(trigger()).toBeNull();
  });
});

describe('activation', () => {
  it('opens the card with the captured selection and hides itself', async () => {
    const field = selectInTextarea('their going to the meating');
    await selectionChanged();

    triggerButton()!.click();
    await settle();

    expect(openCard).toHaveBeenCalledTimes(1);
    const [info] = openCard.mock.calls[0]!;
    expect(info).toMatchObject({
      text: 'their going to the meating',
      elementType: 'textarea',
      element: field,
      selectionStart: 0,
      selectionEnd: 'their going to the meating'.length,
    });
    expect(trigger()).toBeNull();
  });

  /**
   * Pressing the button must not collapse the very selection it is about to
   * rewrite, which is what a default mousedown on a button would do.
   */
  it('prevents the default mousedown so the selection survives', async () => {
    selectInTextarea();
    await selectionChanged();

    const event = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    });
    triggerButton()!.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});
