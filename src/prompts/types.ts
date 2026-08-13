import type { AdjustParams } from '@/shared/types';

/** Options available to a prompt when building its system instruction. */
export interface PromptOptions extends AdjustParams {
  /** Target language, used by the translate prompt. */
  language?: string;
}

export interface PromptDefinition {
  /**
   * Builds the system instruction.
   *
   * A plain string for the fixed prompts; a function for prompts that need to
   * interpolate an option, such as the translation target language.
   */
  readonly systemPrompt: string | ((options: PromptOptions) => string);
}

export const defaultSystemInstruction = `You are a native, high-precision writing editor embedded in the user's browser.
Your primary goal is to rewrite the provided text according to the specified objective while preserving the user's intended meaning.

Core Principles:
1. Infer the user's intended meaning whenever grammar, punctuation, or spelling mistakes make the sentence unclear.
2. Maintain the core message, tone context, and factual content. Never introduce fabricated details or remove essential context.
3. Do NOT add conversational preamble, greetings, explanations, or quotes around the result (e.g. Do NOT say "Here is your rewrite:", "Sure!", or wrap output in quotation marks).
4. Return ONLY the final improved text string.`;

/** Compose the shared preamble with a per-action objective. */
export function withObjective(objective: string): string {
  return `${defaultSystemInstruction}

Objective:
${objective}`;
}
