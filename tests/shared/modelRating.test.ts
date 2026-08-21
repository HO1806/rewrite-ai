/**
 * The model ratings shown in the picker.
 *
 * These assert *ordering*, almost never an exact number: the score is a
 * heuristic over model names, and pinning "gpt-oss-120b is 10" would fail the
 * moment another model joined the list. What must hold is that the stronger
 * model comes first.
 */

import { describe, expect, it } from 'vitest';
import { rateModels, rawModelScore } from '@/shared/modelRating';

function order(ids: string[]): string[] {
  return rateModels(ids).map((entry) => entry.id);
}

describe('rateModels orders a real catalogue', () => {
  /**
   * The regression that made this worth testing: the version detector read the
   * "20" of `20b` as version 20, while `120b` matched nothing — so the small
   * model outranked the large one.
   */
  it('puts a bigger model above a smaller one from the same family', () => {
    expect(order(['openai/gpt-oss-20b', 'openai/gpt-oss-120b'])).toEqual([
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
    ]);
  });

  it.each([
    [
      'Anthropic tiers',
      ['claude-haiku-4-5-20251001', 'claude-opus-5', 'claude-sonnet-5'],
      ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
    ],
    [
      "OpenAI's named tiers",
      ['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra'],
      ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
    ],
    [
      'Gemini versions and the lite penalty',
      ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.7-flash'],
      ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'],
    ],
    [
      'local Ollama tags',
      ['llama3.2', 'deepseek-r1:70b', 'qwen3:8b'],
      ['deepseek-r1:70b', 'qwen3:8b', 'llama3.2'],
    ],
  ])('orders %s', (_label, input, expected) => {
    expect(order(input)).toEqual(expected);
  });

  /**
   * Two models can round to the same displayed number and still have an order
   * worth keeping, so sorting uses the raw score.
   */
  it('keeps the newer version first even when both display the same rating', () => {
    const rated = rateModels([
      'gemini-3.6-flash',
      'gemini-3.7-flash',
      'gemini-3.5-flash-lite',
    ]);

    expect(rated[0]!.id).toBe('gemini-3.7-flash');
    expect(rated[0]!.rating).toBe(rated[1]!.rating);
  });
});

describe('the rating scale', () => {
  it('spans 1 to 10 across the list', () => {
    const rated = rateModels(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);

    expect(rated[0]!.rating).toBe(10);
    expect(rated[1]!.rating).toBe(1);
  });

  /** Relative to the list, so the only option is the best option. */
  it('rates a single model 10', () => {
    expect(rateModels(['anything-at-all-7b'])[0]!.rating).toBe(10);
  });

  it('rates equal signals equally', () => {
    // Same tier word, no version and no size on either: nothing to separate them.
    const rated = rateModels(['acme-large', 'zeta-large']);

    expect(rated[0]!.rating).toBe(rated[1]!.rating);
  });
});

describe('a name with nothing to go on', () => {
  it('scores null rather than inventing a number', () => {
    expect(rawModelScore('compound')).toBeNull();
    expect(rawModelScore('my-finetune')).toBeNull();
  });

  it('sorts unrated models last, still listed', () => {
    const rated = rateModels(['compound', 'openai/gpt-oss-120b']);

    expect(rated.map((entry) => entry.id)).toEqual([
      'openai/gpt-oss-120b',
      'compound',
    ]);
    expect(rated[1]!.rating).toBeNull();
  });

  /** A date is not a version, and must not be read as one. */
  it('does not mistake a date stamp for a version', () => {
    expect(rawModelScore('claude-haiku-4-5-20251001')).toBeLessThan(
      rawModelScore('claude-opus-5')!,
    );
  });

  it('reads a mixture-of-experts size', () => {
    expect(order(['mixtral-8x7b', 'mistral-7b'])).toEqual([
      'mixtral-8x7b',
      'mistral-7b',
    ]);
  });
});
