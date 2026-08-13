import { describe, expect, it, vi } from 'vitest';
import {
  registerStreamHandler,
  toUserMessage,
} from '@/background/streamHandler';
import { AIProviderError } from '@/ai/types';
import { STREAM_PORT_NAME } from '@/shared/constants';
import { saveSettings, settingsSchema } from '@/storage/settings';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import type { StreamMessage, StreamRequest } from '@/shared/types';
import { MockPort, createPortPair } from '../chromeMock';
import { chromeMock } from '../setup';
import { sseResponse, stubFetch } from '../helpers/http';

function frames(...contents: string[]): string[] {
  return [
    ...contents.map(
      (content) =>
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
    ),
    'data: [DONE]',
  ];
}

const REQUEST: StreamRequest = {
  type: 'START_REWRITE',
  action: 'improve',
  text: 'fix this',
};

/** Wire up the handler and return the client end of a connected port. */
function connect(name = STREAM_PORT_NAME): {
  client: MockPort;
  server: MockPort;
} {
  registerStreamHandler();
  const [client, server] = createPortPair(name);
  for (const listener of chromeMock.listeners.connect) listener(server);
  return { client, server };
}

function received(port: MockPort): StreamMessage[] {
  return port.inbox as StreamMessage[];
}

/** Let queued promises settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function seedSettings(
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await saveSettings(
    settingsSchema.parse({
      ...DEFAULT_SETTINGS,
      apiKey: 'sk-test',
      ...overrides,
    }),
  );
}

describe('registerStreamHandler', () => {
  it('ignores ports with a different name', () => {
    const { client } = connect('some-other-port');
    client.postMessage(REQUEST);
    expect(received(client)).toHaveLength(0);
  });

  it('streams chunks and then a DONE with the full text', async () => {
    await seedSettings();
    stubFetch([sseResponse(frames('Fix ', 'this.'))]);

    const { client } = connect();
    client.postMessage(REQUEST);
    await settle();

    expect(received(client)).toEqual([
      { type: 'CHUNK', text: 'Fix ' },
      { type: 'CHUNK', text: 'this.' },
      { type: 'DONE', fullText: 'Fix this.' },
    ]);
  });

  it('rejects a malformed payload without contacting a provider', async () => {
    await seedSettings();
    const calls = stubFetch([sseResponse(frames('x'))]);

    const { client } = connect();
    client.postMessage({
      type: 'START_REWRITE',
      action: 'not-an-action',
      text: 'hi',
    });
    await settle();

    expect(calls).toHaveLength(0);
    expect(received(client)[0]).toMatchObject({ type: 'ERROR' });
  });

  it('rejects text longer than the input cap', async () => {
    await seedSettings();
    const calls = stubFetch([sseResponse(frames('x'))]);

    const { client } = connect();
    client.postMessage({ ...REQUEST, text: 'a'.repeat(20_001) });
    await settle();

    expect(calls).toHaveLength(0);
    expect(received(client)[0]).toMatchObject({ type: 'ERROR' });
  });

  it('ignores a message that is not a START_REWRITE', async () => {
    await seedSettings();
    const { client } = connect();
    client.postMessage({ type: 'SOMETHING_ELSE' });
    await settle();

    expect(received(client)[0]).toMatchObject({ type: 'ERROR' });
  });

  /**
   * An all-dropped stream used to report DONE with an empty string, which
   * cleared the card's spinner and left a blank box with no error.
   */
  it('reports an empty completion as an error', async () => {
    await seedSettings();
    stubFetch([sseResponse(['data: [DONE]'])]);

    const { client } = connect();
    client.postMessage(REQUEST);
    await settle();

    expect(received(client)).toEqual([
      {
        type: 'ERROR',
        message: expect.stringContaining('empty response') as unknown as string,
      },
    ]);
  });

  it('maps an invalid key to actionable guidance', async () => {
    await seedSettings();
    stubFetch([
      new Response(JSON.stringify({ error: { message: 'bad' } }), {
        status: 401,
      }),
    ]);

    const { client } = connect();
    client.postMessage(REQUEST);
    await settle();

    expect(received(client)[0]).toEqual({
      type: 'ERROR',
      message: 'Invalid API key. Check your key in the extension options.',
    });
  });

  it('surfaces a configuration error, such as a custom provider with no host', async () => {
    await seedSettings({ provider: 'custom', baseUrl: '' });
    stubFetch([sseResponse(frames('x'))]);

    const { client } = connect();
    client.postMessage(REQUEST);
    await settle();

    expect(received(client)[0]).toMatchObject({
      type: 'ERROR',
      message: expect.stringContaining('base URL') as unknown as string,
    });
  });

  /**
   * The headline regression. Disconnecting mid-stream must abort the request
   * without throwing — this used to post to a dead port, throw, post the error
   * to the same dead port and throw again inside an async listener.
   */
  it('aborts the provider request when the port disconnects mid-stream', async () => {
    await seedSettings();

    let capturedSignal: AbortSignal | undefined;
    const encoder = new TextEncoder();
    globalThis.fetch = ((_url: string, init: RequestInit) => {
      capturedSignal = init.signal ?? undefined;
      // A body that never completes, so the disconnect lands mid-stream.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`${frames('partial')[0]}\n\n`));
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as typeof fetch;

    const { client } = connect();
    client.postMessage(REQUEST);
    await settle();

    expect(capturedSignal?.aborted).toBe(false);

    client.disconnect();
    await settle();

    expect(capturedSignal?.aborted).toBe(true);
    // No ERROR is posted for a deliberate cancellation.
    expect(received(client).some((message) => message.type === 'ERROR')).toBe(
      false,
    );
  });

  it('does not throw when a chunk arrives after the port has gone', async () => {
    await seedSettings();
    stubFetch([sseResponse(frames('a', 'b'))]);

    const { client, server } = connect();
    client.postMessage(REQUEST);
    // Kill the server end so every postMessage would throw.
    server.isDisconnected = true;
    server.notifyDisconnect();

    await expect(settle()).resolves.toBeUndefined();
  });

  it('supersedes an in-flight request when a second one arrives', async () => {
    await seedSettings();
    const signals: AbortSignal[] = [];
    const encoder = new TextEncoder();

    globalThis.fetch = ((_url: string, init: RequestInit) => {
      if (init.signal) signals.push(init.signal);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`${frames('x')[0]}\n\n`));
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as typeof fetch;

    const { client } = connect();
    client.postMessage(REQUEST);
    await settle();
    client.postMessage({ ...REQUEST, adjustParams: { tone: 'funny' } });
    await settle();

    expect(signals).toHaveLength(2);
    expect(signals[0]!.aborted).toBe(true);
  });

  it('applies adjustments to the prompt it sends', async () => {
    await seedSettings();
    const calls = stubFetch([sseResponse(frames('ok'))]);

    const { client } = connect();
    client.postMessage({
      ...REQUEST,
      adjustParams: { tone: 'funny', length: 'short' },
    });
    await settle();

    const body = JSON.parse(String(calls[0]!.init.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages.find(
      (message) => message.role === 'system',
    )!.content;
    expect(system).toMatch(/humorous/i);
    expect(system).toMatch(/short/i);
  });

  it('passes the configured translate language through', async () => {
    await seedSettings({ translateLanguage: 'Portuguese' });
    const calls = stubFetch([sseResponse(frames('ok'))]);

    const { client } = connect();
    client.postMessage({ ...REQUEST, action: 'translate' });
    await settle();

    expect(String(calls[0]!.init.body)).toContain('Portuguese');
  });

  it('times out a request that never finishes', async () => {
    vi.useFakeTimers();
    try {
      await seedSettings();
      let capturedSignal: AbortSignal | undefined;
      globalThis.fetch = ((_url: string, init: RequestInit) => {
        capturedSignal = init.signal ?? undefined;
        return new Promise(() => {});
      }) as typeof fetch;

      const { client } = connect();
      client.postMessage(REQUEST);
      await vi.advanceTimersByTimeAsync(0);

      expect(capturedSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(90_001);
      expect(capturedSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('toUserMessage', () => {
  it('stays silent for a deliberate cancellation', () => {
    expect(
      toUserMessage(new AIProviderError('cancelled', 'CANCELLED')),
    ).toBeNull();
  });

  it.each([
    ['INVALID_API_KEY', /Invalid API key/],
    ['RATE_LIMIT', /Rate limit/],
    ['TIMEOUT', /timed out/],
    ['NETWORK_ERROR', /Could not reach/],
  ] as const)('explains %s in plain language', (code, pattern) => {
    expect(toUserMessage(new AIProviderError('raw detail', code))).toMatch(
      pattern,
    );
  });

  it('passes a provider message through unchanged', () => {
    expect(
      toUserMessage(new AIProviderError('model overloaded', 'PROVIDER_ERROR')),
    ).toBe('model overloaded');
  });

  it('handles a thrown non-Error', () => {
    expect(toUserMessage('a bare string')).toBe('a bare string');
    expect(toUserMessage(undefined)).toBe('Unexpected error');
  });
});
