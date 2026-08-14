/**
 * AI Provider type definitions.
 *
 * Every provider implements the AIProvider interface, so the rest of the
 * codebase never knows which provider is in use. Adding a provider requires:
 *   1. Add its variant to ProviderConfig below
 *   2. Implement AIProvider (usually by extending OpenAICompatibleProvider)
 *   3. Register it in the factory
 */

import type { ProviderType } from '@/shared/types';

/**
 * Configuration passed to a provider at construction time.
 *
 * This is a discriminated union rather than one flat shape so the type system
 * enforces what each provider actually needs: Ollama takes no API key, and
 * `custom` cannot be constructed without an explicit baseUrl (a missing one
 * used to silently fall through to api.openai.com, sending the user's
 * self-hosted key to OpenAI).
 */
export type ProviderConfig =
  | { provider: 'openai'; apiKey: string; model: string; baseUrl?: string }
  | { provider: 'groq'; apiKey: string; model: string }
  | { provider: 'gemini'; apiKey: string; model: string }
  | {
      provider: 'openrouter';
      apiKey: string;
      model: string;
      attribution?: { referer: string; title: string };
    }
  | { provider: 'anthropic'; apiKey: string; model: string }
  | { provider: 'ollama'; model: string; baseUrl: string }
  | { provider: 'custom'; apiKey: string; model: string; baseUrl: string };

/** Narrow a ProviderConfig to the variant for a given provider type. */
export type ConfigFor<T extends ProviderType> = Extract<
  ProviderConfig,
  { provider: T }
>;

/** Options for a single rewrite call */
export interface RewriteOptions {
  temperature: number;
  maxTokens: number;
  stream: boolean;
  /**
   * Aborts the in-flight request. Without this, a cancelled generation keeps
   * streaming from the (paid) provider to completion in the background.
   */
  signal?: AbortSignal;
}

/**
 * The core provider interface.
 *
 * `rewrite()` returns an AsyncGenerator that yields text chunks.
 * When `stream` is false, a single chunk with the full text is yielded.
 * When `stream` is true, chunks arrive as the model generates them.
 */
export interface AIProvider {
  readonly name: string;
  /**
   * `userContent` is the fully-built user turn from `assemblePrompt`, not the raw
   * selection: the selected text arrives wrapped in a delimiter and surrounded by
   * the task. Providers pass it through untouched.
   */
  rewrite(
    userContent: string,
    systemPrompt: string,
    options: RewriteOptions,
  ): AsyncGenerator<string, void, unknown>;
}

export type AIProviderErrorCode =
  | 'INVALID_API_KEY'
  | 'RATE_LIMIT'
  | 'NETWORK_ERROR'
  | 'PROVIDER_ERROR'
  | 'STREAM_ERROR'
  | 'EMPTY_RESPONSE'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'OFFLINE';

/**
 * Standardized error thrown by providers.
 * Consumers can switch on `code` for programmatic error handling.
 */
export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly code: AIProviderErrorCode,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

/**
 * Abort reasons, passed to `AbortController.abort(reason)` so a cancelled
 * request can be told apart from one that timed out.
 */
export const ABORT_CANCELLED = 'rewrite-ai:cancelled';
export const ABORT_TIMEOUT = 'rewrite-ai:timeout';

/** Map an aborted signal to the matching provider error. */
export function abortErrorFor(
  signal: AbortSignal | undefined,
): AIProviderError {
  if (signal?.reason === ABORT_TIMEOUT) {
    return new AIProviderError('The request timed out.', 'TIMEOUT');
  }
  return new AIProviderError('Request cancelled.', 'CANCELLED');
}
