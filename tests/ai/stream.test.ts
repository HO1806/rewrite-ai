import { describe, expect, it } from 'vitest';
import {
  extractStandardError,
  parseNDJSONStream,
  parseSSEStream,
  readJsonBody,
} from '@/ai/stream';
import { ABORT_TIMEOUT, AIProviderError } from '@/ai/types';
import { digString } from '@/ai/json';
import {
  collect,
  failingStreamResponse,
  jsonResponse,
  ndjsonResponse,
  sseResponse,
  streamResponse,
  textResponse,
} from '../helpers/http';

const HANDLERS = {
  extractDelta: (frame: unknown) =>
    digString(frame, 'choices', 0, 'delta', 'content') ?? null,
  extractError: extractStandardError,
};

const NDJSON_HANDLERS = {
  extractDelta: (frame: unknown) => digString(frame, 'response') ?? null,
  extractError: (frame: unknown) => digString(frame, 'error') ?? null,
};

function delta(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`;
}

describe('parseSSEStream', () => {
  it('yields each delta in order', async () => {
    const response = sseResponse([
      delta('Hello'),
      delta(' world'),
      'data: [DONE]',
    ]);

    await expect(
      collect(parseSSEStream(response, 'Test', HANDLERS)),
    ).resolves.toEqual(['Hello', ' world']);
  });

  it('stops at [DONE] and ignores anything after it', async () => {
    const response = sseResponse([
      delta('kept'),
      'data: [DONE]',
      delta('discarded'),
    ]);

    await expect(
      collect(parseSSEStream(response, 'Test', HANDLERS)),
    ).resolves.toEqual(['kept']);
  });

  it('ignores comment lines and empty deltas', async () => {
    const response = sseResponse([': keep-alive', delta(''), delta('text')]);

    await expect(
      collect(parseSSEStream(response, 'Test', HANDLERS)),
    ).resolves.toEqual(['text']);
  });

  it('reassembles a frame split across network chunks', async () => {
    const payload = delta('split');
    const response = streamResponse([
      payload.slice(0, 12),
      `${payload.slice(12)}\n\n`,
    ]);

    await expect(
      collect(parseSSEStream(response, 'Test', HANDLERS)),
    ).resolves.toEqual(['split']);
  });

  it('reads a trailing frame that has no terminating blank line', async () => {
    const response = streamResponse([delta('last')]);

    await expect(
      collect(parseSSEStream(response, 'Test', HANDLERS)),
    ).resolves.toEqual(['last']);
  });

  it('joins multi-line data fields per the SSE spec', async () => {
    const json = JSON.stringify({
      choices: [{ delta: { content: 'joined' } }],
    });
    const half = Math.floor(json.length / 2);
    const response = sseResponse([
      `data: ${json.slice(0, half)}\ndata: ${json.slice(half)}`,
    ]);

    await expect(
      collect(parseSSEStream(response, 'Test', HANDLERS)),
    ).resolves.toEqual(['joined']);
  });

  it('skips malformed JSON frames rather than failing the stream', async () => {
    const response = sseResponse(['data: {not json', delta('survives')]);

    await expect(
      collect(parseSSEStream(response, 'Test', HANDLERS)),
    ).resolves.toEqual(['survives']);
  });

  describe('HTTP error mapping', () => {
    it.each([
      [401, 'INVALID_API_KEY'],
      [403, 'INVALID_API_KEY'],
      [429, 'RATE_LIMIT'],
      [500, 'PROVIDER_ERROR'],
    ])('maps status %i to %s', async (status, code) => {
      const response = jsonResponse({ error: { message: 'nope' } }, { status });

      await expect(
        collect(parseSSEStream(response, 'Test', HANDLERS)),
      ).rejects.toMatchObject({
        code,
        statusCode: status,
      });
    });

    it('surfaces the provider message from the error body', async () => {
      const response = jsonResponse(
        { error: { message: 'billing hard limit' } },
        { status: 400 },
      );

      await expect(
        collect(parseSSEStream(response, 'Test', HANDLERS)),
      ).rejects.toThrow(/billing hard limit/);
    });

    it('falls back to raw text when the error body is not JSON', async () => {
      const response = textResponse('<html>Bad Gateway</html>', {
        status: 502,
      });

      await expect(
        collect(parseSSEStream(response, 'Test', HANDLERS)),
      ).rejects.toThrow(/Bad Gateway/);
    });
  });

  it('rejects a response with no body', async () => {
    const response = new Response(null, { status: 200 });

    await expect(
      collect(parseSSEStream(response, 'Test', HANDLERS)),
    ).rejects.toMatchObject({
      code: 'STREAM_ERROR',
    });
  });

  /**
   * The regression that mattered most: providers report failures inside an
   * HTTP 200 stream. These frames used to yield no delta, get dropped, and let
   * the stream end normally — the user saw silently truncated text.
   */
  it('raises an error frame received mid-stream', async () => {
    const response = sseResponse([
      delta('partial'),
      `data: ${JSON.stringify({ error: { message: 'context_length_exceeded' } })}`,
      delta('never reached'),
    ]);

    const generator = parseSSEStream(response, 'Test', HANDLERS);
    await expect(collect(generator)).rejects.toThrow(/context_length_exceeded/);
  });

  it('converts a mid-stream transport failure into STREAM_ERROR', async () => {
    const response = failingStreamResponse(
      delta('partial'),
      new Error('connection reset'),
    );

    await expect(
      collect(parseSSEStream(response, 'Test', HANDLERS)),
    ).rejects.toMatchObject({
      code: 'STREAM_ERROR',
    });
  });

  it('reports a timeout when the signal was aborted with the timeout reason', async () => {
    const controller = new AbortController();
    const response = failingStreamResponse(
      delta('partial'),
      new Error('aborted'),
    );
    controller.abort(ABORT_TIMEOUT);

    await expect(
      collect(parseSSEStream(response, 'Test', HANDLERS, controller.signal)),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('reports cancellation when the signal was aborted by the user', async () => {
    const controller = new AbortController();
    const response = failingStreamResponse(
      delta('partial'),
      new Error('aborted'),
    );
    controller.abort();

    await expect(
      collect(parseSSEStream(response, 'Test', HANDLERS, controller.signal)),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

describe('parseNDJSONStream', () => {
  it('yields each line of text', async () => {
    const response = ndjsonResponse([
      JSON.stringify({ response: 'one ' }),
      JSON.stringify({ response: 'two' }),
      JSON.stringify({ done: true }),
    ]);

    await expect(
      collect(parseNDJSONStream(response, 'Ollama', NDJSON_HANDLERS)),
    ).resolves.toEqual(['one ', 'two']);
  });

  /** This path previously had no status mapping at all. */
  it.each([
    [401, 'INVALID_API_KEY'],
    [429, 'RATE_LIMIT'],
    [500, 'PROVIDER_ERROR'],
  ])('maps status %i to %s', async (status, code) => {
    const response = jsonResponse({ error: 'nope' }, { status });

    await expect(
      collect(parseNDJSONStream(response, 'Ollama', NDJSON_HANDLERS)),
    ).rejects.toMatchObject({ code });
  });

  /** Ollama's `{"error": "..."}` lines used to be silently dropped. */
  it('raises an error line received mid-stream', async () => {
    const response = ndjsonResponse([
      JSON.stringify({ response: 'partial' }),
      JSON.stringify({ error: 'model not found' }),
    ]);

    await expect(
      collect(parseNDJSONStream(response, 'Ollama', NDJSON_HANDLERS)),
    ).rejects.toThrow(/model not found/);
  });

  it('reads a trailing line with no newline', async () => {
    const response = streamResponse([JSON.stringify({ response: 'tail' })]);

    await expect(
      collect(parseNDJSONStream(response, 'Ollama', NDJSON_HANDLERS)),
    ).resolves.toEqual(['tail']);
  });
});

describe('readJsonBody', () => {
  it('parses a JSON body', async () => {
    await expect(
      readJsonBody(jsonResponse({ ok: 1 }), 'Test'),
    ).resolves.toEqual({ ok: 1 });
  });

  /** Prevents a raw `Unexpected token '<'` SyntaxError reaching the user. */
  it('raises a provider error for a non-JSON body', async () => {
    await expect(
      readJsonBody(textResponse('<html>oops</html>'), 'Test'),
    ).rejects.toBeInstanceOf(AIProviderError);
  });
});
