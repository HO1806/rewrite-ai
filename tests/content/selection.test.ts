import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSelectionInfo, positionBelow } from '@/content/selection';
import { CARD } from '@/shared/constants';

/** jsdom returns an all-zero rect, so element geometry is stubbed per test. */
function stubRect(element: Element, rect: Partial<DOMRect>): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect);
}

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', {
    value: width,
    configurable: true,
  });
  Object.defineProperty(window, 'innerHeight', {
    value: height,
    configurable: true,
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  setViewport(1280, 900);
  window.getSelection()?.removeAllRanges();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('getSelectionInfo for form fields', () => {
  it('reads the selected substring from a textarea', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'hello brave world';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.setSelectionRange(6, 11);

    expect(getSelectionInfo()).toMatchObject({
      text: 'brave',
      elementType: 'textarea',
    });
  });

  it('reads the selected substring from a text input', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = 'abcdef';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(2, 4);

    expect(getSelectionInfo()).toMatchObject({
      text: 'cd',
      elementType: 'input',
    });
  });

  it('returns null when the caret is collapsed', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'text';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.setSelectionRange(2, 2);

    expect(getSelectionInfo()).toBeNull();
  });

  /** These types throw on setSelectionRange, so they must not take this path. */
  it.each(['email', 'number', 'checkbox', 'date'])(
    'ignores an input[type=%s]',
    (type) => {
      const input = document.createElement('input');
      input.type = type;
      document.body.appendChild(input);
      input.focus();

      expect(getSelectionInfo()).toBeNull();
    },
  );

  /**
   * The card is position: fixed, so its coordinates must be viewport-relative.
   * Adding window.scrollY here pushed the card off-screen by the scroll
   * distance, making the extension look inert on any scrolled page.
   */
  it('produces viewport coordinates regardless of scroll offset', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'hello world';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.setSelectionRange(0, 5);
    stubRect(textarea, { top: 100, bottom: 140, left: 50 });

    Object.defineProperty(window, 'scrollY', {
      value: 2000,
      configurable: true,
    });
    Object.defineProperty(window, 'scrollX', {
      value: 300,
      configurable: true,
    });

    const info = getSelectionInfo();

    expect(info!.position.top).toBe(140 + CARD.offset);
    expect(info!.position.left).toBe(50);
    expect(info!.position.top).toBeLessThan(window.innerHeight);
  });
});

describe('getSelectionInfo for window selections', () => {
  function selectContents(element: Element): void {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  it('detects a contenteditable selection', () => {
    const host = document.createElement('div');
    host.setAttribute('contenteditable', 'true');
    Object.defineProperty(host, 'isContentEditable', {
      value: true,
      configurable: true,
    });
    host.textContent = 'editable text';
    document.body.appendChild(host);
    selectContents(host);

    expect(getSelectionInfo()).toMatchObject({
      text: 'editable text',
      elementType: 'contenteditable',
    });
  });

  it('classifies static page text as unknown but still returns it', () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = 'just reading';
    document.body.appendChild(paragraph);
    selectContents(paragraph);

    expect(getSelectionInfo()).toMatchObject({
      text: 'just reading',
      elementType: 'unknown',
    });
  });

  it('returns null for a whitespace-only selection', () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = '   ';
    document.body.appendChild(paragraph);
    selectContents(paragraph);

    expect(getSelectionInfo()).toBeNull();
  });

  it('returns null when nothing is selected', () => {
    expect(getSelectionInfo()).toBeNull();
  });
});

describe('positionBelow', () => {
  const rect = (values: Partial<DOMRect>): DOMRect =>
    ({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
      ...values,
    }) as DOMRect;

  it('places the card just below the anchor when there is room', () => {
    const position = positionBelow(rect({ top: 50, bottom: 80, left: 200 }));

    expect(position).toEqual({ top: 80 + CARD.offset, left: 200 });
  });

  /**
   * With the drawer open the card is ~480px tall. Clamping against a hardcoded
   * 300px pushed the action buttons below the fold, where a fixed-position
   * element cannot be scrolled into view.
   */
  it('flips above the anchor when there is not enough room below', () => {
    setViewport(1280, 700);
    const position = positionBelow(rect({ top: 600, bottom: 640, left: 100 }));

    expect(position.top).toBeLessThan(600);
    expect(position.top).toBeGreaterThanOrEqual(CARD.margin);
  });

  it('keeps the whole card inside the viewport height', () => {
    setViewport(1280, 700);
    const position = positionBelow(rect({ top: 300, bottom: 340, left: 100 }));

    expect(position.top + CARD.maxHeight).toBeLessThanOrEqual(700);
  });

  it('clamps the left edge so the card cannot overhang the right side', () => {
    setViewport(500, 900);
    const position = positionBelow(rect({ top: 10, bottom: 40, left: 480 }));

    expect(position.left + CARD.width).toBeLessThanOrEqual(500);
  });

  it('never positions the card off the left or top edge', () => {
    const position = positionBelow(
      rect({ top: -100, bottom: -50, left: -200 }),
    );

    expect(position.left).toBeGreaterThanOrEqual(CARD.margin);
    expect(position.top).toBeGreaterThanOrEqual(CARD.margin);
  });

  it('stays within the margin even when the viewport is narrower than the card', () => {
    setViewport(300, 900);
    const position = positionBelow(rect({ top: 10, bottom: 40, left: 100 }));

    expect(position.left).toBe(CARD.margin);
  });
});
