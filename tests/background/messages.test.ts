import { describe, expect, it } from 'vitest';
import {
  backgroundToContentMessageSchema,
  describeValidationError,
  streamMessageSchema,
  streamRequestSchema,
} from '@/background/messages';
import { MAX_INPUT_LENGTH } from '@/shared/constants';

describe('backgroundToContentMessageSchema', () => {
  it('accepts a rewrite trigger', () => {
    const result = backgroundToContentMessageSchema.safeParse({
      type: 'TRIGGER_REWRITE',
      action: 'improve',
      language: 'English',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a trigger carrying the translation language', () => {
    expect(
      backgroundToContentMessageSchema.safeParse({
        type: 'TRIGGER_REWRITE',
        action: 'translate',
        language: 'French',
      }).success,
    ).toBe(true);
  });

  /** The content script must never have to look this up for itself. */
  it('rejects a trigger with no language', () => {
    expect(
      backgroundToContentMessageSchema.safeParse({
        type: 'TRIGGER_REWRITE',
        action: 'improve',
      }).success,
    ).toBe(false);
  });

  it.each([
    ['an unknown type', { type: 'HACK', action: 'improve', text: 'x' }],
    [
      'an unknown action',
      { type: 'REWRITE_REQUEST', action: 'destroy', text: 'x' },
    ],
    ['a missing text field', { type: 'REWRITE_REQUEST', action: 'improve' }],
    ['a null payload', null],
    ['a bare string', 'REWRITE_REQUEST'],
  ])('rejects %s', (_label, payload) => {
    expect(backgroundToContentMessageSchema.safeParse(payload).success).toBe(
      false,
    );
  });
});

describe('streamRequestSchema', () => {
  it('accepts a minimal request', () => {
    expect(
      streamRequestSchema.safeParse({
        type: 'START_REWRITE',
        action: 'improve',
        text: 'x',
      }).success,
    ).toBe(true);
  });

  it('accepts text at exactly the cap', () => {
    expect(
      streamRequestSchema.safeParse({
        type: 'START_REWRITE',
        action: 'improve',
        text: 'a'.repeat(MAX_INPUT_LENGTH),
      }).success,
    ).toBe(true);
  });

  /** Unbounded text meant an unbounded request and bill. */
  it('rejects text over the cap', () => {
    expect(
      streamRequestSchema.safeParse({
        type: 'START_REWRITE',
        action: 'improve',
        text: 'a'.repeat(MAX_INPUT_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it.each([
    ['empty text', { type: 'START_REWRITE', action: 'improve', text: '' }],
    [
      'a non-string text',
      { type: 'START_REWRITE', action: 'improve', text: 42 },
    ],
    [
      'a removed action',
      { type: 'START_REWRITE', action: 'concise', text: 'x' },
    ],
    ['an unknown action', { type: 'START_REWRITE', action: 'nope', text: 'x' }],
  ])('rejects %s', (_label, payload) => {
    expect(streamRequestSchema.safeParse(payload).success).toBe(false);
  });
});

describe('streamMessageSchema', () => {
  it.each([
    { type: 'CHUNK', text: 'partial' },
    { type: 'DONE', fullText: 'complete' },
    { type: 'ERROR', message: 'went wrong' },
  ])('accepts %o', (payload) => {
    expect(streamMessageSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects a CHUNK with no text', () => {
    expect(streamMessageSchema.safeParse({ type: 'CHUNK' }).success).toBe(
      false,
    );
  });
});

describe('describeValidationError', () => {
  it('names the offending field', () => {
    const result = streamRequestSchema.safeParse({
      type: 'START_REWRITE',
      action: 'improve',
      text: '',
    });
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(describeValidationError(result.error)).toContain('text');
  });
});
