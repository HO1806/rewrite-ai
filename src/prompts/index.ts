import type { RewriteAction } from '@/shared/types';
import { PROMPTS } from './definitions';
import { collectAdjustments } from './adjustments';
import { PromptOptions } from './types';

export * from './types';
export { PROMPTS } from './definitions';

/**
 * Build the system prompt for an action, applying any adjustments.
 *
 * `options` is typed as PromptOptions rather than Record<string, string> so the
 * tone/format/length unions survive the call — passing them as bare strings let
 * an unrecognised value pass the type check and then silently do nothing.
 */
export function getPromptForAction(
  action: RewriteAction,
  options: PromptOptions = {},
): string {
  const definition = PROMPTS[action];
  const basePrompt =
    typeof definition.systemPrompt === 'function'
      ? definition.systemPrompt(options)
      : definition.systemPrompt;

  const adjustments = collectAdjustments(options);
  if (adjustments.length === 0) {
    return basePrompt;
  }

  return `${basePrompt}

Apply the following requirements:
- ${adjustments.join('\n- ')}`;
}
