/**
 * Prompt definitions for every rewrite action.
 *
 * These lived in seven separate files, six of which were structurally identical
 * ten-line modules differing only in two string literals — about seventy lines
 * of scaffolding to hold six sentences. Their `name` and `description` fields
 * were rendered nowhere; display labels come from `ACTIONS` in shared/constants.
 *
 * Each objective is a bare transformation clause: the prompt frame in
 * `assemble.ts` names the text being transformed, so an objective that named it
 * too would be a second definition of the same fact.
 */

import type { RewriteAction } from '@/shared/types';
import { PromptDefinition, PromptOptions } from './types';

export const PROMPTS: Record<RewriteAction, PromptDefinition> = {
  improve: {
    /**
     * "Enhance sentence flow, vocabulary, and readability" used to sit here, and
     * it is what turned a terse arrow-notation message into flowing prose —
     * 117 characters became 167 on a real WhatsApp message. Being the more
     * specific instruction, and sitting next to the content, it beat the
     * system prompt's rule about matching length. Clarity is the goal; a wider
     * vocabulary and fuller sentences were never the point.
     */
    objective:
      'Correct all spelling, punctuation, and grammatical mistakes. Tighten the wording and improve clarity without padding: the result should be no longer than the original and must keep every detail it contains. Infer intended meaning where syntax is broken. Keep the original perspective, voice, and level of formality.',
  },

  grammar: {
    objective:
      "Fix all grammatical, spelling, and punctuation errors. Make minimal changes to sentence structure and word choice — preserve the user's exact wording wherever grammatically correct.",
  },

  professional: {
    objective:
      'Make it read as clear, professional, respectful, and articulate business or workplace communication. Eliminate slang, overly casual expressions, and filler words while preserving key information.',
  },

  friendly: {
    objective:
      'Make it warm, friendly, approachable, and engaging while keeping it natural and polite. Suited to informal, team, or casual messages.',
  },

  concise: {
    objective:
      'Make it as concise and direct as possible without losing critical details or changing meaning. Remove redundant words, passive phrasing, and fluff.',
  },

  expand: {
    objective:
      'Add structural clarity, smoother transitions, and the context needed to make it fully fleshed out and articulate. Do not invent unrelated facts.',
  },

  translate: {
    verb: 'translate',
    objective: (options: PromptOptions) =>
      `Render it smoothly and idiomatically in ${options.language || 'English'}. Maintain the original tone, context, formatting, and nuance.`,
  },
};
