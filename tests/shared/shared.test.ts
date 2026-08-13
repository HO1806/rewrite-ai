import { describe, expect, it, vi } from 'vitest';
import {
  ACTIONS,
  FORMAT_OPTIONS,
  LENGTH_OPTIONS,
  PROVIDERS,
  TONE_OPTIONS,
  getAction,
  getDefaultModel,
  getProvider,
} from '@/shared/constants';
import { getErrorMessage, isAbortError } from '@/shared/errors';
import { onSystemThemeChange, resolveTheme } from '@/shared/theme';
import { dig, digString, isRecord, safeJsonParse } from '@/ai/json';

describe('constants', () => {
  it('has a unique descriptor per action', () => {
    const ids = ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every action both a label and a card title', () => {
    for (const action of ACTIONS) {
      expect(action.label.length).toBeGreaterThan(0);
      expect(action.cardTitle.length).toBeGreaterThan(0);
    }
  });

  it('has a unique descriptor per provider, each with at least one model', () => {
    const values = PROVIDERS.map((provider) => provider.value);
    expect(new Set(values).size).toBe(values.length);

    for (const provider of PROVIDERS) {
      expect(provider.models.length).toBeGreaterThan(0);
    }
  });

  it('requires a base URL exactly where one is meaningful', () => {
    const needing = PROVIDERS.filter((provider) => provider.needsBaseUrl).map(
      (p) => p.value,
    );
    expect(needing.sort()).toEqual(['custom', 'ollama']);
  });

  it('resolves an action by id', () => {
    expect(getAction('translate').cardTitle).toBe('Here is the translation');
  });

  it('throws for an unknown action', () => {
    expect(() => getAction('nope' as never)).toThrow(/Unknown rewrite action/);
  });

  it('resolves a provider and its default model', () => {
    expect(getProvider('groq').label).toContain('Groq');
    expect(getDefaultModel('groq')).toBe(
      PROVIDERS.find((p) => p.value === 'groq')!.models[0],
    );
  });

  it('throws for an unknown provider', () => {
    expect(() => getProvider('nope' as never)).toThrow(/Unknown provider/);
  });

  it('gives every adjust option a distinct value and a label', () => {
    for (const group of [TONE_OPTIONS, FORMAT_OPTIONS, LENGTH_OPTIONS]) {
      const values = group.map((option) => option.value);
      expect(new Set(values).size).toBe(values.length);
      for (const option of group)
        expect(option.label.length).toBeGreaterThan(0);
    }
  });

  /** The mislabelled pills that sent the opposite instruction. */
  it('labels each tone as what it actually requests', () => {
    const byValue = new Map(
      TONE_OPTIONS.map((option) => [option.value, option.label]),
    );
    expect(byValue.get('informational')).toBe('Informational');
    expect(byValue.get('funny')).toBe('Funny');
    // Edge offers exactly five; the invented Informal/Neutral pair is gone.
    expect(TONE_OPTIONS).toHaveLength(5);
  });
});

describe('getErrorMessage', () => {
  it.each([
    [new Error('boom'), 'boom'],
    ['a string', 'a string'],
    [undefined, 'Unexpected error'],
    [null, 'Unexpected error'],
    [{ message: 'not an Error' }, 'Unexpected error'],
    [42, 'Unexpected error'],
  ])('narrows %o', (input, expected) => {
    expect(getErrorMessage(input)).toBe(expected);
  });
});

describe('isAbortError', () => {
  it('recognises an AbortError DOMException', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true);
  });

  it.each([
    new Error('AbortError'),
    new DOMException('other', 'TypeError'),
    'AbortError',
  ])('rejects %o', (input) => {
    expect(isAbortError(input)).toBe(false);
  });
});

describe('resolveTheme', () => {
  function stubPrefersDark(matches: boolean): void {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  }

  it.each(['light', 'dark'] as const)('passes %s through', (theme) => {
    expect(resolveTheme(theme)).toBe(theme);
  });

  it('follows the OS preference for system', () => {
    stubPrefersDark(true);
    expect(resolveTheme('system')).toBe('dark');

    stubPrefersDark(false);
    expect(resolveTheme('system')).toBe('light');
  });

  it('defaults to light when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(resolveTheme('system')).toBe('light');
  });
});

describe('onSystemThemeChange', () => {
  it('reports a preference change and unsubscribes cleanly', () => {
    const listeners: Array<(event: MediaQueryListEvent) => void> = [];
    const removeEventListener = vi.fn();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: (
          _name: string,
          fn: (event: MediaQueryListEvent) => void,
        ) => listeners.push(fn),
        removeEventListener,
      })),
    );

    const callback = vi.fn();
    const unsubscribe = onSystemThemeChange(callback);

    listeners[0]!({ matches: true } as MediaQueryListEvent);
    expect(callback).toHaveBeenCalledWith('dark');

    listeners[0]!({ matches: false } as MediaQueryListEvent);
    expect(callback).toHaveBeenCalledWith('light');

    unsubscribe();
    expect(removeEventListener).toHaveBeenCalled();
  });

  it('is a no-op when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(() => onSystemThemeChange(vi.fn())()).not.toThrow();
  });
});

describe('json helpers', () => {
  it('identifies plain records only', () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([1, 2])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('str')).toBe(false);
  });

  it('walks object keys and array indices', () => {
    const value = { choices: [{ delta: { content: 'hi' } }] };
    expect(dig(value, 'choices', 0, 'delta', 'content')).toBe('hi');
  });

  it.each([
    ['a missing key', ['choices', 0, 'absent']],
    ['an index into a non-array', ['choices', 'delta']],
    ['a key into a non-object', ['choices', 0, 'delta', 'content', 'deeper']],
    ['an out-of-range index', ['choices', 5, 'delta']],
  ])('returns undefined for %s', (_label, path) => {
    const value = { choices: [{ delta: { content: 'hi' } }] };
    expect(dig(value, ...(path as Array<string | number>))).toBeUndefined();
  });

  it('returns strings only, and never an empty one', () => {
    expect(digString({ a: 'x' }, 'a')).toBe('x');
    expect(digString({ a: '' }, 'a')).toBeUndefined();
    expect(digString({ a: 5 }, 'a')).toBeUndefined();
    expect(digString({ a: null }, 'a')).toBeUndefined();
  });

  it('parses JSON without throwing', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
    expect(safeJsonParse('not json')).toBeUndefined();
    expect(safeJsonParse('')).toBeUndefined();
  });
});
