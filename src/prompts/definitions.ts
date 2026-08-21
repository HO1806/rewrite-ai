/**
 * Prompt definitions for every rewrite action.
 *
 * Two remain of seven. The other five were reachable only from a right-click
 * menu that no longer exists, and Fix Grammar was folded into `improve` rather
 * than deleted — see the objective below.
 *
 * Each objective is a bare transformation clause: the prompt frame in
 * `assemble.ts` names the text being transformed, so an objective that named it
 * too would be a second definition of the same fact.
 */

import type { RewriteAction } from '@/shared/types';
import { PromptDefinition, PromptOptions } from './types';

export const PROMPTS: Record<RewriteAction, PromptDefinition> = {
  /**
   * Deliberately adaptive, and that is the whole objective.
   *
   * The user's ask: "fix grammar if what I typed doesn't need rewriting but
   * needs correction, and the opposite". So the amount of change is the model's
   * judgement, not a fixed instruction — a message that is already clear should
   * come back almost identical, and only a clumsy one should be reworked. This
   * replaces a separate Fix Grammar action.
   */
  improve: {
    objective:
      'Judge how much change the text actually needs, and make only that much. When it is already clear, correct the spelling, punctuation and grammar and change nothing else — keep the wording, the order and the register exactly as they are. When it genuinely reads poorly or the meaning is muddled, rewrite it properly: fix the flow, the word choice and the structure, inferring what was meant where the syntax is broken. Never rewrite for the sake of rewriting, and never pad. Keep the original perspective and voice throughout.',
  },

  translate: {
    verb: 'translate',
    objective: (options: PromptOptions) =>
      `Render it smoothly and idiomatically in ${options.language || 'English'}. Maintain the original tone, context, formatting, and nuance.`,
  },
};
