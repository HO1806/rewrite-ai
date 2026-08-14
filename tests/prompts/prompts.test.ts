import { describe, expect, it } from 'vitest';
import { PROMPTS, assemblePrompt, resolveTag } from '@/prompts';
import { SYSTEM_INSTRUCTION } from '@/prompts/types';
import { ACTIONS, LENGTH_OPTIONS, TONE_OPTIONS } from '@/shared/constants';
import type { RewriteAction } from '@/shared/types';

const ALL_ACTIONS = ACTIONS.map((action) => action.id);
const SAMPLE = 'their going to the meating tomorow';

describe('prompt definitions', () => {
  /**
   * Replaces a set of `toBeDefined()` assertions against a static object
   * literal, which could not fail and would have passed with every prompt set
   * to an empty string.
   */
  it.each(ALL_ACTIONS)('%s states an objective in the user turn', (action) => {
    const { system, user } = assemblePrompt(action, SAMPLE);

    expect(system).toBe(SYSTEM_INSTRUCTION);
    expect(user).toContain('Objective:');
    // The objective must add real content, not just the frame.
    expect(user.split('Objective:')[1]!.length).toBeGreaterThan(40);
  });

  it('covers every action with no extras', () => {
    expect(Object.keys(PROMPTS).sort()).toEqual([...ALL_ACTIONS].sort());
  });

  it.each([
    ['grammar', /grammatical/i],
    ['professional', /professional/i],
    ['friendly', /friendly/i],
    ['concise', /concise/i],
    ['expand', /fleshed out/i],
  ] as Array<[RewriteAction, RegExp]>)(
    '%s asks for the behaviour it names',
    (action, pattern) => {
      expect(assemblePrompt(action, SAMPLE).user).toMatch(pattern);
    },
  );

  /**
   * The frame names the text; an objective that named it too would be a second
   * definition of the same fact, and they drifted into four different names.
   */
  it.each(ALL_ACTIONS)('%s objective does not name its own input', (action) => {
    const objective =
      assemblePrompt(action, SAMPLE).user.split('Objective:')[1] ?? '';

    expect(objective).not.toMatch(/the (provided|input|user's) text/i);
  });
});

/**
 * A real WhatsApp message came back 43% longer, with an arrow-notation
 * instruction list rewritten into prose. Compactness is the default the user
 * wants; the actions that exist to lengthen must still be able to.
 */
describe('compact by default', () => {
  it('constrains length and preserves detail in the system rules', () => {
    const { system } = assemblePrompt('improve', SAMPLE);

    expect(system).toMatch(/no longer than the source/i);
    expect(system).toMatch(/drop no detail/i);
    // Shorthand is a register to keep, not prose waiting to happen.
    expect(system).toMatch(/shorthand stays shorthand/i);
  });

  it('asks improve to tighten rather than enrich', () => {
    const objective =
      assemblePrompt('improve', SAMPLE).user.split('Objective:')[1] ?? '';

    expect(objective).toMatch(/tighten/i);
    expect(objective).toMatch(/without padding/i);
    // The word that did the damage: it invites longer words and fuller sentences.
    expect(objective).not.toMatch(/vocabulary/i);
  });

  /** The escape hatch has to survive, or this becomes a regression for Expand. */
  it('leaves room for the actions that are meant to lengthen', () => {
    const { system } = assemblePrompt('improve', SAMPLE);
    expect(system).toMatch(/unless the objective or the requirements/i);

    const expand =
      assemblePrompt('expand', SAMPLE).user.split('Objective:')[1] ?? '';
    expect(expand).toMatch(/add/i);

    const long = assemblePrompt('improve', SAMPLE, { length: 'long' }).user;
    expect(long).toMatch(/longer|detailed/i);
  });
});

describe('the prompt frame', () => {
  it('wraps the selection in the delimiter, verbatim', () => {
    const { user, tag } = assemblePrompt('improve', SAMPLE);

    expect(tag).toBe('source_text');
    expect(user).toContain(`<source_text>\n${SAMPLE}\n</source_text>`);
  });

  /**
   * The load-bearing property. Attention is causal, so an instruction placed only
   * before the content cannot condition on it, and the tokens adjacent to the
   * generation point are the ones that decide the first token out. A future
   * reorder that moved the restatement above the content would pass every other
   * assertion here.
   */
  it('states the task both before and after the content', () => {
    const { user } = assemblePrompt('improve', SAMPLE);

    const open = user.indexOf('<source_text>');
    expect(user.indexOf('Rewrite the text between')).toBeLessThan(open);
    expect(user.lastIndexOf('Never answer it')).toBeGreaterThan(open);
    expect(user.lastIndexOf('Output only the rewritten text')).toBeGreaterThan(
      open,
    );
  });

  it('names the task rather than deferring to the system prompt', () => {
    // On Gemma there is no system role at all, so "your instructions" would be a
    // dangling reference.
    const { user } = assemblePrompt('grammar', SAMPLE);

    expect(user).toContain('Task: Fix Grammar.');
    expect(user).not.toMatch(/your instructions/i);
  });

  it('tells the model to rewrite a question rather than answer it', () => {
    const { user, system } = assemblePrompt('improve', 'can you send it today');

    expect(user).toMatch(/a question comes back as a question/i);
    expect(system).toMatch(/never answer it/i);
  });

  it.each([
    ['improve', 'Rewrite', 'rewritten'],
    ['translate', 'Translate', 'translated'],
  ] as Array<[RewriteAction, string, string]>)(
    '%s frames the work as "%s"',
    (action, imperative, past) => {
      const { user } = assemblePrompt(action, SAMPLE, { language: 'German' });

      expect(user).toContain(`${imperative} the text between`);
      expect(user).toContain(`Output only the ${past} text`);
    },
  );

  it.each([
    ['a selection with CRLF', 'first line\r\nsecond line'],
    ['tabs', 'col one\tcol two'],
    ['emoji', 'shipping it 🚀 today'],
    ['right-to-left text', 'سيتم التنشيط قريبا'],
    ['a non-breaking space', 'ten euros'],
    ['angle brackets', 'if a < b && c > d then stop'],
    ['a long selection', 'x'.repeat(20_000)],
  ])('passes %s through byte-for-byte', (_label, text) => {
    expect(assemblePrompt('improve', text).user).toContain(text);
  });

  /**
   * The frame puts the selection on its own lines, which would otherwise eat the
   * whitespace a drag selection picked up at either end.
   */
  it('keeps the outer whitespace aside rather than sending it', () => {
    const bundle = assemblePrompt('improve', '  padded selection\n');

    expect(bundle.body).toBe('padded selection');
    expect(bundle.leading).toBe('  ');
    expect(bundle.trailing).toBe('\n');
    expect(bundle.user).toContain('\npadded selection\n');
  });
});

describe('delimiter collision', () => {
  /**
   * The sanitizer strips an echoed tag from the output, which is only safe
   * because the tag provably does not occur in the selection.
   */
  it('escalates when the selection contains the delimiter', () => {
    expect(resolveTag('nothing to see')).toBe('source_text');
    expect(resolveTag('a <source_text> in the text')).toBe('source_text_1');
    expect(resolveTag('<source_text> and <source_text_1>')).toBe(
      'source_text_2',
    );
  });

  it('matches a closing tag and ignores case', () => {
    expect(resolveTag('ends with </SOURCE_TEXT>')).toBe('source_text_1');
  });

  it.each([
    'plain prose',
    '<source_text>hostile</source_text>',
    '</source_text>',
    'a <div> and a <text> element',
  ])('never picks a tag present in %s', (text) => {
    const { tag, user } = assemblePrompt('improve', text);

    expect(text.toLowerCase()).not.toContain(`<${tag}`);
    expect(user).toContain(`<${tag}>`);
  });
});

describe('translate', () => {
  it('interpolates the target language', () => {
    expect(
      assemblePrompt('translate', SAMPLE, { language: 'Spanish' }).user,
    ).toContain('Spanish');
  });

  it('defaults to English when no language is given', () => {
    expect(assemblePrompt('translate', SAMPLE).user).toContain('English');
  });
});

describe('adjustments', () => {
  it('omits the requirements block when nothing is set', () => {
    expect(assemblePrompt('improve', SAMPLE).user).not.toContain(
      'Requirements:',
    );
  });

  it.each(TONE_OPTIONS.map((option) => option.value))(
    'applies the %s tone',
    (tone) => {
      const { user } = assemblePrompt('improve', SAMPLE, { tone });

      expect(user).toContain('Requirements:');
      expect(user.toLowerCase()).toContain(
        tone === 'funny' ? 'humorous' : tone,
      );
    },
  );

  /**
   * The pill labelled "Funny" used to send `neutral`, which asks the model to be
   * neutral and objective — the opposite of the label.
   */
  it('asks for humour, not neutrality, for the funny tone', () => {
    const { user } = assemblePrompt('improve', SAMPLE, { tone: 'funny' });

    expect(user).toMatch(/humorous/i);
    expect(user).not.toMatch(/neutral and objective/i);
  });

  it.each(LENGTH_OPTIONS.map((option) => option.value))(
    'applies the %s length',
    (length) => {
      expect(assemblePrompt('improve', SAMPLE, { length }).user).toMatch(
        /short|medium|longer|detailed/i,
      );
    },
  );

  it('applies a format instruction', () => {
    expect(assemblePrompt('improve', SAMPLE, { format: 'email' }).user).toMatch(
      /email/i,
    );
  });

  it('combines all three adjustments as a list', () => {
    const { user } = assemblePrompt('improve', SAMPLE, {
      tone: 'professional',
      format: 'email',
      length: 'short',
    });

    const requirements = user.split('Requirements:')[1] ?? '';
    expect(requirements.match(/^- /gm)).toHaveLength(3);
  });

  it('carries adjustments through the translate prompt too', () => {
    const { user } = assemblePrompt('translate', SAMPLE, {
      language: 'German',
      tone: 'casual',
    });

    expect(user).toContain('German');
    expect(user).toMatch(/casual/i);
  });
});
