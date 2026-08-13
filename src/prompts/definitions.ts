/**
 * Prompt definitions for every rewrite action.
 *
 * These lived in seven separate files, six of which were structurally identical
 * ten-line modules differing only in two string literals — about seventy lines
 * of scaffolding to hold six sentences. Their `name` and `description` fields
 * were rendered nowhere; display labels come from `ACTIONS` in shared/constants.
 */

import type { RewriteAction } from '@/shared/types';
import { PromptDefinition, PromptOptions, withObjective } from './types';

export const PROMPTS: Record<RewriteAction, PromptDefinition> = {
  improve: {
    systemPrompt: withObjective(
      "Improve the user's writing. Correct all spelling, punctuation, and grammatical mistakes. Enhance sentence flow, vocabulary, and readability. Infer intended meaning where syntax is broken. Keep the original perspective and voice.",
    ),
  },

  grammar: {
    systemPrompt: withObjective(
      "Fix all grammatical, spelling, and punctuation errors. Make minimal changes to sentence structure and word choice — preserve the user's exact wording wherever grammatically correct.",
    ),
  },

  professional: {
    systemPrompt: withObjective(
      'Rewrite the text to sound clear, professional, respectful, and articulate for business or workplace communication. Eliminate slang, overly casual expressions, and filler words while preserving key information.',
    ),
  },

  friendly: {
    systemPrompt: withObjective(
      'Rewrite the text to be warm, friendly, approachable, and engaging while keeping it natural and polite. Perfect for informal, team, or casual messages.',
    ),
  },

  concise: {
    systemPrompt: withObjective(
      'Make the text as concise and direct as possible without losing critical details or changing meaning. Remove redundant words, passive phrasing, and fluff.',
    ),
  },

  expand: {
    systemPrompt: withObjective(
      'Expand the provided text by adding structural clarity, smoother transitions, and necessary context to make it fully fleshed out and articulate. Do not invent unrelated facts.',
    ),
  },

  translate: {
    systemPrompt: (options: PromptOptions) =>
      withObjective(
        `Translate the input text smoothly and idiomatically into ${options.language || 'English'}. Maintain the original tone, context, formatting, and nuance.`,
      ),
  },
};
