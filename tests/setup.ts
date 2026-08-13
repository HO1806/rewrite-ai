import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { installChromeMock, type ChromeMock } from './chromeMock';

/** The current test's Chrome mock. Reinstalled fresh before every test. */
export let chromeMock: ChromeMock;

/**
 * jsdom does not implement Range.getBoundingClientRect. Tests that care about
 * geometry stub it per case; this keeps the rest from throwing.
 */
if (typeof Range.prototype.getBoundingClientRect !== 'function') {
  Range.prototype.getBoundingClientRect = function emptyRect(): DOMRect {
    return {
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

/**
 * jsdom does not implement ResizeObserver. The card uses one to reposition when
 * the adjust drawer changes its height; a no-op stub is enough here, and the
 * real behaviour is covered by the Playwright suite.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

beforeEach(() => {
  chromeMock = installChromeMock();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
