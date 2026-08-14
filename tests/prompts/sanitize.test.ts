import { describe, expect, it } from 'vitest';
import { assemblePrompt, sanitizeResult } from '@/prompts';

function contextFor(source: string) {
  const { tag, body, leading, trailing } = assemblePrompt('improve', source);
  return { tag, body, leading, trailing };
}

const PLAIN = contextFor('their going to the meating tomorow');

describe('sanitizeResult strips what we put there', () => {
  it('removes an echoed delimiter wrapping the whole result', () => {
    expect(
      sanitizeResult(
        '<source_text>They are going to the meeting.</source_text>',
        PLAIN,
      ),
    ).toBe('They are going to the meeting.');
  });

  it('leaves a delimiter in the middle alone', () => {
    // Visible garbage beats guessing at surgery inside the result.
    const output = 'They are <source_text> going to the meeting.';

    expect(sanitizeResult(output, PLAIN)).toBe(output);
  });

  it('removes symmetric wrapping quotes', () => {
    expect(sanitizeResult('"They are going to the meeting."', PLAIN)).toBe(
      'They are going to the meeting.',
    );
  });

  it('removes curly wrapping quotes', () => {
    expect(sanitizeResult('“Good morning.”', PLAIN)).toBe('Good morning.');
  });

  /**
   * A model can nest the wrappers either way round, so one pass in a fixed order
   * always leaves one of them behind.
   */
  it.each([
    '"<source_text>Hello.</source_text>"',
    '<source_text>"Hello."</source_text>',
  ])('unwraps %s completely and stays there', (output) => {
    const once = sanitizeResult(output, PLAIN);

    expect(once).toBe('Hello.');
    expect(sanitizeResult(once, PLAIN)).toBe(once);
  });
});

describe('sanitizeResult refuses to corrupt a real rewrite', () => {
  /**
   * The case that makes naive quote-stripping dangerous: the ends are a matching
   * pair, but they are not a wrapper.
   */
  it('keeps quotes around interior dialogue', () => {
    const output = '"Yes," he said, "we will."';

    expect(sanitizeResult(output, PLAIN)).toBe(output);
  });

  it('keeps the quotes when the source was itself quoted', () => {
    const quoted = contextFor('"we will ship it"');
    const output = '"We will ship it."';

    expect(sanitizeResult(output, quoted)).toBe(output);
  });

  /**
   * A rewriting tool sees this constantly, and it is exactly what a preamble
   * regex would destroy — which is why there is no preamble stripping.
   */
  it('leaves a result that legitimately opens with "Here is"', () => {
    const output = 'Here is the agenda: two items, both short.';

    expect(sanitizeResult(output, PLAIN)).toBe(output);
  });

  it('leaves an unmatched quote alone', () => {
    expect(sanitizeResult('"partial quote', PLAIN)).toBe('"partial quote');
  });

  it('leaves a mismatched pair alone', () => {
    expect(sanitizeResult('“mixed pair"', PLAIN)).toBe('“mixed pair"');
  });

  it('handles a result too short to be a wrapper', () => {
    expect(sanitizeResult('"', PLAIN)).toBe('"');
  });
});

describe('sanitizeResult restores the selection whitespace', () => {
  it('gives back the padding the frame trimmed off', () => {
    const padded = contextFor('  padded selection\n');

    expect(sanitizeResult('tidied selection', padded)).toBe(
      '  tidied selection\n',
    );
  });

  it('does not add padding that was never there', () => {
    expect(sanitizeResult('  loose result  ', PLAIN)).toBe('loose result');
  });
});
