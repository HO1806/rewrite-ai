/**
 * Response stream parsing shared by every provider.
 *
 * Two framings are supported: Server-Sent Events (all providers except Ollama)
 * and newline-delimited JSON (Ollama). Both route their HTTP error handling
 * through `assertResponseOk` so a 401 maps to INVALID_API_KEY regardless of
 * which framing — or whether streaming is on at all.
 */

import { AIProviderError, abortErrorFor } from './types';
import { dig, digString, safeJsonParse } from './json';
import { getErrorMessage, isAbortError } from '@/shared/errors';

/** Extracts the text delta from one decoded stream frame, or null if it carries none. */
export type DeltaExtractor = (frame: unknown) => string | null;

/**
 * Extracts a provider error message from one decoded stream frame.
 *
 * Providers routinely report failures *inside* an HTTP 200 stream — OpenAI and
 * Groq emit `{"error":{...}}`, Anthropic sends an `event: error` frame, Gemini
 * reports `promptFeedback.blockReason`. Without this hook those frames yield no
 * delta, get dropped, and the stream ends normally: the user receives silently
 * truncated text with no indication anything went wrong.
 */
export type ErrorExtractor = (frame: unknown) => string | null;

/**
 * True when a frame says generation stopped because it ran out of room.
 *
 * Not an error — the text produced so far is real and usable — but the user has
 * to be told, or a rewrite that stops mid-sentence looks like the model's
 * considered answer. Every dialect reports this differently and none of them
 * treats it as a failure, which is why it was invisible.
 */
export type TruncationDetector = (frame: unknown) => boolean;

export interface StreamHandlers {
  extractDelta: DeltaExtractor;
  extractError?: ErrorExtractor;
  isTruncated?: TruncationDetector;
}

/** The `{ error: { message } }` shape used by OpenAI, Groq, OpenRouter and Anthropic. */
export const extractStandardError: ErrorExtractor = (frame) =>
  digString(frame, 'error', 'message') ?? digString(frame, 'error') ?? null;

/**
 * Validate an HTTP response before reading its body.
 * Shared by the streaming and non-streaming paths of every provider.
 */
export async function assertResponseOk(
  response: Response,
  providerLabel: string,
): Promise<void> {
  if (response.ok) return;

  const detail = await readErrorDetail(response);

  if (response.status === 401 || response.status === 403) {
    throw new AIProviderError(
      `${providerLabel}: invalid API key or unauthorized. ${detail}`,
      'INVALID_API_KEY',
      response.status,
    );
  }
  if (response.status === 429) {
    throw new AIProviderError(
      `${providerLabel}: rate limit exceeded. ${detail}`,
      'RATE_LIMIT',
      response.status,
    );
  }
  throw new AIProviderError(
    `${providerLabel} error (${response.status}): ${detail}`,
    'PROVIDER_ERROR',
    response.status,
  );
}

/** Pull the most useful message out of an error response body. */
async function readErrorDetail(response: Response): Promise<string> {
  let rawText: string;
  try {
    rawText = await response.text();
  } catch {
    return response.statusText || 'No further detail available.';
  }

  const parsed = safeJsonParse(rawText);
  if (parsed !== undefined) {
    const message =
      digString(parsed, 'error', 'message') ??
      digString(parsed, 'error') ??
      digString(parsed, 'message');
    if (message) return message;
  }

  return (
    rawText.trim() || response.statusText || 'No further detail available.'
  );
}

/**
 * Read a JSON body, converting a non-JSON payload into a provider error.
 *
 * A gateway that answers HTTP 200 with an HTML error page would otherwise
 * surface a raw `Unexpected token '<'` SyntaxError to the user.
 */
export async function readJsonBody(
  response: Response,
  providerLabel: string,
): Promise<unknown> {
  const rawText = await response.text();
  const parsed = safeJsonParse(rawText);

  if (parsed === undefined) {
    throw new AIProviderError(
      `${providerLabel} returned a non-JSON response: ${rawText.slice(0, 200)}`,
      'PROVIDER_ERROR',
      response.status,
    );
  }

  return parsed;
}

/**
 * Parse a Server-Sent Events response into text chunks.
 *
 * Events are separated by a blank line, and an event's `data:` lines are joined
 * with newlines per the SSE spec — parsing line-by-line instead would corrupt
 * any provider that splits one JSON document across several data lines.
 */
export async function* parseSSEStream(
  response: Response,
  providerLabel: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
  onTruncated?: () => void,
): AsyncGenerator<string, void, unknown> {
  await assertResponseOk(response, providerLabel);

  const reader = getBodyReader(response);
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Events are delimited by a blank line; the trailing fragment stays buffered.
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';

      for (const event of events) {
        const frame = readSSEEvent(event);
        if (frame === undefined) continue;
        if (frame === DONE) return;
        yield* emitFrame(frame, providerLabel, handlers, onTruncated);
      }
    }

    // Providers that end without a trailing blank line leave a final event here.
    const trailing = readSSEEvent(buffer);
    if (trailing !== undefined && trailing !== DONE) {
      yield* emitFrame(trailing, providerLabel, handlers, onTruncated);
    }
  } catch (err: unknown) {
    throw toStreamError(err, providerLabel, signal);
  } finally {
    await cancelReader(reader);
  }
}

/** Parse a newline-delimited JSON response (Ollama) into text chunks. */
export async function* parseNDJSONStream(
  response: Response,
  providerLabel: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
  onTruncated?: () => void,
): AsyncGenerator<string, void, unknown> {
  await assertResponseOk(response, providerLabel);

  const reader = getBodyReader(response);
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        yield* emitJsonLine(line, providerLabel, handlers, onTruncated);
      }
    }

    yield* emitJsonLine(buffer, providerLabel, handlers, onTruncated);
  } catch (err: unknown) {
    throw toStreamError(err, providerLabel, signal);
  } finally {
    await cancelReader(reader);
  }
}

/* ── internals ── */

/** Sentinel for the SSE `[DONE]` terminator. */
const DONE = Symbol('sse-done');

function getBodyReader(
  response: Response,
): ReadableStreamDefaultReader<Uint8Array> {
  if (!response.body) {
    throw new AIProviderError('Response body was empty.', 'STREAM_ERROR');
  }
  return response.body.getReader();
}

/**
 * Decode one SSE event block.
 * Returns undefined for comment-only or dataless events, DONE for `[DONE]`.
 */
function readSSEEvent(event: string): unknown | typeof DONE | undefined {
  const dataLines: string[] = [];

  for (const line of event.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) continue;
    if (trimmed.startsWith('data:')) {
      dataLines.push(trimmed.slice('data:'.length).trim());
    }
  }

  if (dataLines.length === 0) return undefined;

  const payload = dataLines.join('\n');
  if (payload === '[DONE]') return DONE;

  return safeJsonParse(payload);
}

function* emitFrame(
  frame: unknown,
  providerLabel: string,
  handlers: StreamHandlers,
  onTruncated?: () => void,
): Generator<string, void, unknown> {
  if (frame === undefined) return;

  // Checked before the error hook: running out of room is not a failure, and the
  // frame that reports it usually carries the last of the text too.
  if (handlers.isTruncated?.(frame)) onTruncated?.();

  const errorMessage = handlers.extractError?.(frame);
  if (errorMessage) {
    throw new AIProviderError(
      `${providerLabel}: ${errorMessage}`,
      'PROVIDER_ERROR',
    );
  }

  const delta = handlers.extractDelta(frame);
  if (delta) yield delta;
}

function* emitJsonLine(
  line: string,
  providerLabel: string,
  handlers: StreamHandlers,
  onTruncated?: () => void,
): Generator<string, void, unknown> {
  const trimmed = line.trim();
  if (!trimmed) return;
  yield* emitFrame(
    safeJsonParse(trimmed),
    providerLabel,
    handlers,
    onTruncated,
  );
}

function toStreamError(
  err: unknown,
  providerLabel: string,
  signal: AbortSignal | undefined,
): AIProviderError {
  if (err instanceof AIProviderError) return err;
  if (isAbortError(err) || signal?.aborted) return abortErrorFor(signal);
  return new AIProviderError(
    `${providerLabel} stream failed: ${getErrorMessage(err)}`,
    'STREAM_ERROR',
  );
}

/**
 * Release the response body.
 *
 * `cancel()` — not just `releaseLock()` — is what actually tears down the
 * underlying connection when a generation is abandoned mid-stream.
 */
async function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The stream may already be closed or errored; nothing left to release.
  }
}

/** Guard used by providers before issuing a request. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortErrorFor(signal);
}

/** Extract the delta text produced by Gemini's safety/blocking feedback, if any. */
export const extractGeminiError: ErrorExtractor = (frame) => {
  const blockReason = digString(frame, 'promptFeedback', 'blockReason');
  if (blockReason) return `request blocked (${blockReason})`;

  const finishReason = digString(frame, 'candidates', 0, 'finishReason');
  if (
    finishReason &&
    finishReason !== 'STOP' &&
    finishReason !== 'MAX_TOKENS'
  ) {
    return `generation stopped (${finishReason})`;
  }

  return digString(frame, 'error', 'message') ?? null;
};

/** Ollama reports failures as `{"error": "..."}` on an otherwise fine stream. */
export const extractOllamaError: ErrorExtractor = (frame) =>
  digString(frame, 'error') ?? null;

/**
 * The text of a non-streaming completion, or a clear failure.
 *
 * `?? ''` used to stand here, which turned an API shape change or a model
 * refusal — OpenAI puts a refusal in `message.refusal` and leaves `content`
 * null — into a successful, empty rewrite. An absent path is a malformed
 * response and says so; only a genuinely empty string passes through.
 */
export function requireContent(value: unknown, providerLabel: string): string {
  // Takes the raw `dig` result, not `digString`, which folds the empty string
  // into `undefined` — and telling those two apart is the entire job here.
  if (typeof value !== 'string') {
    throw new AIProviderError(
      `${providerLabel} returned a response with no text where content was expected.`,
      'PROVIDER_ERROR',
    );
  }
  return value;
}

/** OpenAI, Groq and OpenRouter: `finish_reason: 'length'`. */
export const isOpenAITruncated: TruncationDetector = (frame) =>
  digString(frame, 'choices', 0, 'finish_reason') === 'length';

/** Anthropic reports the stop reason on its `message_delta` event. */
export const isAnthropicTruncated: TruncationDetector = (frame) =>
  digString(frame, 'delta', 'stop_reason') === 'max_tokens';

/** Gemini, whose error extractor deliberately treats this as a non-error. */
export const isGeminiTruncated: TruncationDetector = (frame) =>
  digString(frame, 'candidates', 0, 'finishReason') === 'MAX_TOKENS';

/** Ollama's final NDJSON frame carries `done_reason`. */
export const isOllamaTruncated: TruncationDetector = (frame) =>
  digString(frame, 'done_reason') === 'length';

/** Anthropic wraps deltas in typed events; only content_block_delta carries text. */
export const extractAnthropicDelta: DeltaExtractor = (frame) => {
  if (dig(frame, 'type') !== 'content_block_delta') return null;
  return digString(frame, 'delta', 'text') ?? null;
};
