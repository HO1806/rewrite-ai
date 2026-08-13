/**
 * Shared provider plumbing.
 *
 * The six providers were previously near-literal copies of one another — a diff
 * of openai.ts against openrouter.ts was four hunks out of seventy-one lines —
 * and they had already drifted apart in ways that mattered (only one permitted
 * a missing key on localhost; only one silently overwrote a user's baseUrl).
 * Everything common now lives here, so a fix lands once.
 */

import {
  AIProvider,
  AIProviderError,
  RewriteOptions,
  abortErrorFor,
} from '../types';
import {
  StreamHandlers,
  assertResponseOk,
  extractStandardError,
  parseSSEStream,
  readJsonBody,
  throwIfAborted,
} from '../stream';
import { digString } from '../json';
import { getErrorMessage, isAbortError } from '@/shared/errors';

/** Strip trailing slashes so endpoint concatenation cannot produce a double slash. */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/**
 * Issue the request, translating transport failures into provider errors.
 *
 * A rejected fetch is indistinguishable from a deliberate abort without
 * checking the signal, so that check happens here rather than in six places.
 */
export async function requestJson(options: {
  endpoint: string;
  headers: Record<string, string>;
  payload: unknown;
  signal?: AbortSignal;
  offlineMessage?: string;
}): Promise<Response> {
  const { endpoint, headers, payload, signal, offlineMessage } = options;

  throwIfAborted(signal);

  try {
    return await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err: unknown) {
    if (isAbortError(err) || signal?.aborted) {
      throw abortErrorFor(signal);
    }
    if (offlineMessage) {
      throw new AIProviderError(
        `${offlineMessage} (${getErrorMessage(err)})`,
        'OFFLINE',
      );
    }
    throw new AIProviderError(
      `Network request failed: ${getErrorMessage(err)}`,
      'NETWORK_ERROR',
    );
  }
}

/**
 * A provider speaking the OpenAI `/chat/completions` dialect.
 *
 * OpenAI, Groq, OpenRouter and any custom OpenAI-compatible server differ only
 * in their host, their headers and their display name, so they are all this
 * class with different constructor arguments.
 */
export abstract class OpenAICompatibleProvider implements AIProvider {
  abstract readonly name: string;

  protected constructor(
    protected readonly apiKey: string,
    protected readonly model: string,
    protected readonly baseUrl: string,
  ) {}

  /** Provider-specific headers merged over the defaults. */
  protected extraHeaders(): Record<string, string> {
    return {};
  }

  /** Whether a request may proceed without an API key (local servers may). */
  protected requiresApiKey(): boolean {
    return true;
  }

  async *rewrite(
    text: string,
    systemPrompt: string,
    options: RewriteOptions,
  ): AsyncGenerator<string, void, unknown> {
    if (this.requiresApiKey() && !this.apiKey) {
      throw new AIProviderError(
        `${this.name} API key is required.`,
        'INVALID_API_KEY',
      );
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.extraHeaders(),
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await requestJson({
      endpoint: `${normalizeBaseUrl(this.baseUrl)}/chat/completions`,
      headers,
      payload: {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        stream: options.stream,
      },
      signal: options.signal,
    });

    if (!options.stream) {
      await assertResponseOk(response, this.name);
      const data = await readJsonBody(response, this.name);
      yield digString(data, 'choices', 0, 'message', 'content') ?? '';
      return;
    }

    yield* parseSSEStream(
      response,
      this.name,
      OPENAI_STREAM_HANDLERS,
      options.signal,
    );
  }
}

const OPENAI_STREAM_HANDLERS: StreamHandlers = {
  extractDelta: (frame) =>
    digString(frame, 'choices', 0, 'delta', 'content') ?? null,
  extractError: extractStandardError,
};
