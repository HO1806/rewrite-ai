/**
 * Phrasing for the tone / format / length adjustments.
 *
 * Each map is keyed by its option union rather than by `string`, so adding a
 * tone forces a phrase to be written for it. The previous `Record<string, ...>`
 * maps silently produced no adjustment for any key that did not match, which is
 * how a mislabelled pill went unnoticed.
 */

import type {
  AdjustParams,
  FormatOption,
  LengthOption,
  ToneOption,
} from '@/shared/types';

const TONE_PHRASES: Record<ToneOption, string> = {
  professional: 'Use a professional and formal tone',
  casual: 'Use a casual and conversational tone',
  enthusiastic: 'Use an enthusiastic and energetic tone',
  informal: 'Use an informal and relaxed tone',
  neutral: 'Use a neutral and objective tone',
  funny: 'Use a light, humorous tone, without undercutting the message',
};

const FORMAT_PHRASES: Record<FormatOption, string> = {
  paragraph: 'Format the result as standard prose paragraphs',
  email: 'Format the result as an email message',
  ideas: 'Format the result as a bulleted list of key ideas',
  blog: 'Format the result as an engaging blog post',
};

const LENGTH_PHRASES: Record<LengthOption, string> = {
  short: 'Keep the result short and concise',
  medium: 'Keep the result to a balanced, medium length',
  long: 'Produce a detailed, longer result',
};

/** Collect the phrases for whichever adjustments are set. */
export function collectAdjustments(params: AdjustParams): string[] {
  const phrases: string[] = [];

  if (params.tone) phrases.push(TONE_PHRASES[params.tone]);
  if (params.format) phrases.push(FORMAT_PHRASES[params.format]);
  if (params.length) phrases.push(LENGTH_PHRASES[params.length]);

  return phrases;
}
