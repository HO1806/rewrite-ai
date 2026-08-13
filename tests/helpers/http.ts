/** Response builders for provider tests. */

export function sseResponse(
  events: string[],
  init: ResponseInit = {},
): Response {
  return streamResponse(
    events.map((event) => `${event}\n\n`),
    init,
  );
}

export function ndjsonResponse(
  lines: string[],
  init: ResponseInit = {},
): Response {
  return streamResponse(
    lines.map((line) => `${line}\n`),
    init,
  );
}

/** A response whose body emits the given text pieces as separate chunks. */
export function streamResponse(
  pieces: string[],
  init: ResponseInit = {},
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });

  return new Response(body, { status: 200, ...init });
}

/** A response that errors partway through, to exercise mid-stream failures. */
export function failingStreamResponse(prefix: string, error: Error): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(prefix));
      controller.error(error);
    },
  });

  return new Response(body, { status: 200 });
}

export function jsonResponse(
  value: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

export function textResponse(text: string, init: ResponseInit = {}): Response {
  return new Response(text, { status: 200, ...init });
}

/** Drain an async generator into an array. */
export async function collect(
  generator: AsyncGenerator<string>,
): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of generator) chunks.push(chunk);
  return chunks;
}

export interface FetchCall {
  url: string;
  init: RequestInit;
}

/**
 * Stub global fetch with a queue of responses, recording every call.
 *
 * The last entry is reused once the queue is exhausted. Note that a Response
 * body can only be read once, so use `stubFetchEach` for anything that issues
 * more than one request and needs each to stream.
 */
export function stubFetch(responses: Array<Response | Error>): FetchCall[] {
  const calls: FetchCall[] = [];
  let index = 0;

  globalThis.fetch = ((url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next as Response);
  }) as typeof fetch;

  return calls;
}

/** Stub global fetch with a factory, so every call gets a fresh, readable body. */
export function stubFetchEach(
  make: (index: number) => Response | Error,
): FetchCall[] {
  const calls: FetchCall[] = [];

  globalThis.fetch = ((url: string, init: RequestInit = {}) => {
    const result = make(calls.length);
    calls.push({ url, init });
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve(result);
  }) as typeof fetch;

  return calls;
}

export function parseBody(call: FetchCall): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

export function headerValue(call: FetchCall, name: string): string | undefined {
  const headers = call.init.headers as Record<string, string> | undefined;
  return headers?.[name];
}
