import { describe, expect, it } from 'vitest';
import { PROMPTS, getPromptForAction } from '@/prompts';
import { defaultSystemInstruction } from '@/prompts/types';
import { ACTIONS, LENGTH_OPTIONS, TONE_OPTIONS } from '@/shared/constants';
import type { RewriteAction } from '@/shared/types';

const ALL_ACTIONS = ACTIONS.map((action) => action.id);

describe('prompt definitions', () => {
  /**
   * Replaces a set of `toBeDefined()` assertions against a static object
   * literal, which could not fail and would have passed with every prompt set
   * to an empty string.
   */
  it.each(ALL_ACTIONS)(
    '%s builds a substantive prompt including the shared preamble',
    (action) => {
      const prompt = getPromptForAction(action);

      expect(prompt).toContain(defaultSystemInstruction);
      expect(prompt).toContain('Objective:');
      // The objective must add real content beyond the shared preamble.
      expect(prompt.length).toBeGreaterThan(
        defaultSystemInstruction.length + 40,
      );
    },
  );

  it('covers every action with no extras', () => {
    expect(Object.keys(PROMPTS).sort()).toEqual([...ALL_ACTIONS].sort());
  });

  it.each([
    ['grammar', /grammatical/i],
    ['professional', /professional/i],
    ['friendly', /friendly/i],
    ['concise', /concise/i],
    ['expand', /expand/i],
  ] as Array<[RewriteAction, RegExp]>)(
    '%s asks for the behaviour it names',
    (action, pattern) => {
      expect(getPromptForAction(action)).toMatch(pattern);
    },
  );
});

describe('translate', () => {
  it('interpolates the target language', () => {
    expect(getPromptForAction('translate', { language: 'Spanish' })).toContain(
      'Spanish',
    );
  });

  it('defaults to English when no language is given', () => {
    expect(getPromptForAction('translate')).toContain('English');
  });
});

describe('adjustments', () => {
  it('appends nothing when no adjustments are set', () => {
    expect(getPromptForAction('improve')).not.toContain(
      'Apply the following requirements',
    );
  });

  it.each(TONE_OPTIONS.map((option) => option.value))(
    'applies the %s tone',
    (tone) => {
      const prompt = getPromptForAction('improve', { tone });
      expect(prompt).toContain('Apply the following requirements');
      expect(prompt.toLowerCase()).toContain(
        tone === 'funny' ? 'humorous' : tone,
      );
    },
  );

  /**
   * The pill labelled "Funny" used to send `neutral`, which asks the model to be
   * neutral and objective — the opposite of the label.
   */
  it('asks for humour, not neutrality, for the funny tone', () => {
    const prompt = getPromptForAction('improve', { tone: 'funny' });
    expect(prompt).toMatch(/humorous/i);
    expect(prompt).not.toMatch(/neutral and objective/i);
  });

  it.each(LENGTH_OPTIONS.map((option) => option.value))(
    'applies the %s length',
    (length) => {
      expect(getPromptForAction('improve', { length })).toMatch(
        /short|medium|longer|detailed/i,
      );
    },
  );

  it('applies a format instruction', () => {
    expect(getPromptForAction('improve', { format: 'email' })).toMatch(
      /email/i,
    );
  });

  it('combines all three adjustments as a list', () => {
    const prompt = getPromptForAction('improve', {
      tone: 'professional',
      format: 'email',
      length: 'short',
    });

    const requirements =
      prompt.split('Apply the following requirements:')[1] ?? '';
    expect(requirements.match(/^- /gm)).toHaveLength(3);
  });

  it('carries adjustments through the translate prompt too', () => {
    const prompt = getPromptForAction('translate', {
      language: 'German',
      tone: 'casual',
    });
    expect(prompt).toContain('German');
    expect(prompt).toMatch(/casual/i);
  });
});
