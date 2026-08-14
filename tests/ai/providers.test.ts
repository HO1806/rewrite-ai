/**
 * Provider request/response contracts.
 *
 * The previous suite asserted only that a stream of two well-formed OpenAI
 * frames produced two strings. It checked no endpoint, no auth header and no
 * payload field, so a provider that hit the wrong host, sent the wrong model or
 * dropped the API key entirely would have passed.
 */

import { describe, expect, it } from 'vitest';
import { AnthropicProvider } from '@/ai/providers/anthropic';
import { GeminiProvider } from '@/ai/providers/gemini';
import { GroqProvider } from '@/ai/providers/groq';
import { OllamaProvider } from '@/ai/providers/ollama';
import { CustomOpenAIProvider, OpenAIProvider } from '@/ai/providers/openai';
import { OpenRouterProvider } from '@/ai/providers/openrouter';
import type { RewriteOptions } from '@/ai/types';
import {
  collect,
  headerValue,
  jsonResponse,
  ndjsonResponse,
  parseBody,
  sseResponse,
  stubFetch,
} from '../helpers/http';

const OPTIONS: RewriteOptions = {
  temperature: 0.4,
  maxTokens: 999,
  stream: true,
};
const NO_STREAM: RewriteOptions = { ...OPTIONS, stream: false };

function openAIFrames(...contents: string[]): string[] {
  return [
    ...contents.map(
      (content) =>
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
    ),
    'data: [DONE]',
  ];
}

describe('OpenAI-compatible providers', () => {
  it('posts to the chat completions endpoint with a bearer token', async () => {
    const calls = stubFetch([sseResponse(openAIFrames('Hi', ' there'))]);
    const provider = new OpenAIProvider({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
    });

    await expect(
      collect(provider.rewrite('draft', 'be nice', OPTIONS)),
    ).resolves.toEqual(['Hi', ' there']);

    const call = calls[0]!;
    expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(headerValue(call, 'Authorization')).toBe('Bearer sk-test');
    expect(parseBody(call)).toMatchObject({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: 999,
      stream: true,
      messages: [
        { role: 'system', content: 'be nice' },
        { role: 'user', content: 'draft' },
      ],
    });
  });

  it('honours a custom base URL without a trailing slash problem', async () => {
    const calls = stubFetch([sseResponse(openAIFrames('x'))]);
    const provider = new OpenAIProvider({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'm',
      baseUrl: 'https://proxy.example.com/v1/',
    });

    await collect(provider.rewrite('t', 's', OPTIONS));
    expect(calls[0]!.url).toBe('https://proxy.example.com/v1/chat/completions');
  });

  it('requires an API key', async () => {
    stubFetch([sseResponse(openAIFrames('x'))]);
    const provider = new OpenAIProvider({
      provider: 'openai',
      apiKey: '',
      model: 'm',
    });

    await expect(
      collect(provider.rewrite('t', 's', OPTIONS)),
    ).rejects.toMatchObject({
      code: 'INVALID_API_KEY',
    });
  });

  it('allows a missing key against a loopback server', async () => {
    stubFetch([sseResponse(openAIFrames('local'))]);
    const provider = new OpenAIProvider({
      provider: 'openai',
      apiKey: '',
      model: 'm',
      baseUrl: 'http://localhost:1234/v1',
    });

    await expect(collect(provider.rewrite('t', 's', OPTIONS))).resolves.toEqual(
      ['local'],
    );
  });

  it('reads the full completion on the non-streaming path', async () => {
    stubFetch([
      jsonResponse({ choices: [{ message: { content: 'whole thing' } }] }),
    ]);
    const provider = new OpenAIProvider({
      provider: 'openai',
      apiKey: 'sk',
      model: 'm',
    });

    await expect(
      collect(provider.rewrite('t', 's', NO_STREAM)),
    ).resolves.toEqual(['whole thing']);
  });

  /** The non-streaming branch used to throw a bare PROVIDER_ERROR for a 401. */
  it('maps a 401 on the non-streaming path to INVALID_API_KEY', async () => {
    stubFetch([
      jsonResponse({ error: { message: 'bad key' } }, { status: 401 }),
    ]);
    const provider = new OpenAIProvider({
      provider: 'openai',
      apiKey: 'sk',
      model: 'm',
    });

    await expect(
      collect(provider.rewrite('t', 's', NO_STREAM)),
    ).rejects.toMatchObject({
      code: 'INVALID_API_KEY',
    });
  });

  it('maps a transport failure to NETWORK_ERROR', async () => {
    stubFetch([new Error('dns failure')]);
    const provider = new OpenAIProvider({
      provider: 'openai',
      apiKey: 'sk',
      model: 'm',
    });

    await expect(
      collect(provider.rewrite('t', 's', OPTIONS)),
    ).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('passes the abort signal through to fetch', async () => {
    const calls = stubFetch([sseResponse(openAIFrames('x'))]);
    const controller = new AbortController();
    const provider = new OpenAIProvider({
      provider: 'openai',
      apiKey: 'sk',
      model: 'm',
    });

    await collect(
      provider.rewrite('t', 's', { ...OPTIONS, signal: controller.signal }),
    );
    expect(calls[0]!.init.signal).toBe(controller.signal);
  });

  it('refuses to start when the signal is already aborted', async () => {
    stubFetch([sseResponse(openAIFrames('x'))]);
    const controller = new AbortController();
    controller.abort();
    const provider = new OpenAIProvider({
      provider: 'openai',
      apiKey: 'sk',
      model: 'm',
    });

    await expect(
      collect(
        provider.rewrite('t', 's', { ...OPTIONS, signal: controller.signal }),
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('sends Groq to the Groq host, ignoring any stored base URL', async () => {
    const calls = stubFetch([sseResponse(openAIFrames('g'))]);
    const provider = new GroqProvider({
      provider: 'groq',
      apiKey: 'gsk',
      model: 'llama',
    });

    await collect(provider.rewrite('t', 's', OPTIONS));
    expect(calls[0]!.url).toBe(
      'https://api.groq.com/openai/v1/chat/completions',
    );
    expect(provider.name).toBe('Groq');
  });

  it('omits OpenRouter attribution headers unless configured', async () => {
    const calls = stubFetch([sseResponse(openAIFrames('o'))]);
    const provider = new OpenRouterProvider({
      provider: 'openrouter',
      apiKey: 'or',
      model: 'm',
    });

    await collect(provider.rewrite('t', 's', OPTIONS));
    expect(headerValue(calls[0]!, 'HTTP-Referer')).toBeUndefined();
    expect(headerValue(calls[0]!, 'X-Title')).toBeUndefined();
  });

  it('sends OpenRouter attribution headers when configured', async () => {
    const calls = stubFetch([sseResponse(openAIFrames('o'))]);
    const provider = new OpenRouterProvider({
      provider: 'openrouter',
      apiKey: 'or',
      model: 'm',
      attribution: { referer: 'https://example.com', title: 'Example' },
    });

    await collect(provider.rewrite('t', 's', OPTIONS));
    expect(headerValue(calls[0]!, 'HTTP-Referer')).toBe('https://example.com');
    expect(headerValue(calls[0]!, 'X-Title')).toBe('Example');
  });

  it('uses the supplied host for a custom server and reports an honest name', async () => {
    const calls = stubFetch([sseResponse(openAIFrames('c'))]);
    const provider = new CustomOpenAIProvider({
      provider: 'custom',
      apiKey: 'k',
      model: 'm',
      baseUrl: 'https://self.hosted/v1',
    });

    await collect(provider.rewrite('t', 's', OPTIONS));
    expect(calls[0]!.url).toBe('https://self.hosted/v1/chat/completions');
    expect(provider.name).toBe('Custom server');
  });
});

describe('AnthropicProvider', () => {
  it('posts to the messages endpoint with the versioned headers', async () => {
    const calls = stubFetch([
      sseResponse([
        `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: 'Claude' } })}`,
        'data: [DONE]',
      ]),
    ]);
    const provider = new AnthropicProvider({
      provider: 'anthropic',
      apiKey: 'sk-ant',
      model: 'claude-x',
    });

    await expect(
      collect(provider.rewrite('draft', 'sys', OPTIONS)),
    ).resolves.toEqual(['Claude']);

    const call = calls[0]!;
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(headerValue(call, 'x-api-key')).toBe('sk-ant');
    expect(headerValue(call, 'anthropic-version')).toBe('2023-06-01');
    // The correctly-prefixed header; the old unprefixed spelling was ignored
    // by the API and rejected at CORS preflight.
    expect(headerValue(call, 'anthropic-dangerous-direct-browser-access')).toBe(
      'true',
    );
    // The messages array was never inspected here, so a provider that dropped the
    // user content entirely would have passed. Each provider carries it in a
    // different field, which is why every one of them needs this assertion.
    expect(parseBody(call)).toMatchObject({
      system: 'sys',
      model: 'claude-x',
      messages: [{ role: 'user', content: 'draft' }],
    });
  });

  it('ignores event types that carry no text', async () => {
    stubFetch([
      sseResponse([
        `data: ${JSON.stringify({ type: 'message_start' })}`,
        `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: 'only this' } })}`,
      ]),
    ]);
    const provider = new AnthropicProvider({
      provider: 'anthropic',
      apiKey: 'k',
      model: 'm',
    });

    await expect(collect(provider.rewrite('t', 's', OPTIONS))).resolves.toEqual(
      ['only this'],
    );
  });

  it('reads the non-streaming content array', async () => {
    stubFetch([jsonResponse({ content: [{ text: 'full reply' }] })]);
    const provider = new AnthropicProvider({
      provider: 'anthropic',
      apiKey: 'k',
      model: 'm',
    });

    await expect(
      collect(provider.rewrite('t', 's', NO_STREAM)),
    ).resolves.toEqual(['full reply']);
  });
});

describe('GeminiProvider', () => {
  it('sends the key as a header and never in the URL', async () => {
    const calls = stubFetch([
      sseResponse([
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Gemini' }] } }] })}`,
      ]),
    ]);
    const provider = new GeminiProvider({
      provider: 'gemini',
      apiKey: 'AIza-secret',
      model: 'gemini-1.5-flash',
    });

    await expect(
      collect(provider.rewrite('draft', 'sys', OPTIONS)),
    ).resolves.toEqual(['Gemini']);

    const call = calls[0]!;
    expect(headerValue(call, 'x-goog-api-key')).toBe('AIza-secret');
    // A key in the query string ends up in server, proxy and net-export logs.
    expect(call.url).not.toContain('AIza-secret');
    expect(call.url).not.toContain('key=');
    expect(call.url).toContain(':streamGenerateContent?alt=sse');
    // Gemini had no payload assertion whatsoever, so it could have sent an empty
    // request and passed. Its two fields are named differently from every other
    // provider's, which is precisely why it needs pinning.
    expect(parseBody(call)).toMatchObject({
      systemInstruction: { parts: [{ text: 'sys' }] },
      contents: [{ role: 'user', parts: [{ text: 'draft' }] }],
    });
  });

  it('percent-encodes the user-supplied model name', async () => {
    const calls = stubFetch([sseResponse(['data: {}'])]);
    const provider = new GeminiProvider({
      provider: 'gemini',
      apiKey: 'k',
      model: 'models/a b',
    });

    await collect(provider.rewrite('t', 's', OPTIONS));
    expect(calls[0]!.url).toContain('models%2Fa%20b');
  });

  it('raises a safety block reported mid-stream', async () => {
    stubFetch([
      sseResponse([
        `data: ${JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } })}`,
      ]),
    ]);
    const provider = new GeminiProvider({
      provider: 'gemini',
      apiKey: 'k',
      model: 'm',
    });

    await expect(collect(provider.rewrite('t', 's', OPTIONS))).rejects.toThrow(
      /SAFETY/,
    );
  });

  it('raises a safety block on the non-streaming path', async () => {
    stubFetch([jsonResponse({ promptFeedback: { blockReason: 'OTHER' } })]);
    const provider = new GeminiProvider({
      provider: 'gemini',
      apiKey: 'k',
      model: 'm',
    });

    await expect(
      collect(provider.rewrite('t', 's', NO_STREAM)),
    ).rejects.toThrow(/OTHER/);
  });
});

describe('OllamaProvider', () => {
  it('posts to the generate endpoint with no auth header', async () => {
    const calls = stubFetch([
      ndjsonResponse([
        JSON.stringify({ response: 'llama' }),
        JSON.stringify({ done: true }),
      ]),
    ]);
    const provider = new OllamaProvider({
      provider: 'ollama',
      model: 'llama3.2',
      baseUrl: 'http://localhost:11434',
    });

    await expect(
      collect(provider.rewrite('draft', 'sys', OPTIONS)),
    ).resolves.toEqual(['llama']);

    const call = calls[0]!;
    expect(call.url).toBe('http://localhost:11434/api/generate');
    expect(headerValue(call, 'Authorization')).toBeUndefined();
    expect(parseBody(call)).toMatchObject({
      model: 'llama3.2',
      system: 'sys',
      prompt: 'draft',
      options: { temperature: 0.4, num_predict: 999 },
    });
  });

  it('reports an unreachable server as OFFLINE with actionable guidance', async () => {
    stubFetch([new Error('Failed to fetch')]);
    const provider = new OllamaProvider({
      provider: 'ollama',
      model: 'm',
      baseUrl: 'http://localhost:11434',
    });

    await expect(
      collect(provider.rewrite('t', 's', OPTIONS)),
    ).rejects.toMatchObject({
      code: 'OFFLINE',
    });
    await expect(collect(provider.rewrite('t', 's', OPTIONS))).rejects.toThrow(
      /OLLAMA_ORIGINS/,
    );
  });

  it('reads the non-streaming response field', async () => {
    stubFetch([jsonResponse({ response: 'done' })]);
    const provider = new OllamaProvider({
      provider: 'ollama',
      model: 'm',
      baseUrl: 'http://localhost:11434',
    });

    await expect(
      collect(provider.rewrite('t', 's', NO_STREAM)),
    ).resolves.toEqual(['done']);
  });
});
