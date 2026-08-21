/**
 * The provider catalogue: `listModels` for each payload shape.
 *
 * This exists because a hardcoded model list is a dated assertion. Groq retired
 * both of the ids this extension shipped two months after announcing them, and
 * the user met it as a 404 mid-rewrite. Asking the provider is the fix, which
 * makes each catalogue response a new untrusted boundary — hence a malformed
 * case per provider, not just a happy path.
 */

import { describe, expect, it } from 'vitest';
import { AnthropicProvider } from '@/ai/providers/anthropic';
import { GeminiProvider } from '@/ai/providers/gemini';
import { GroqProvider } from '@/ai/providers/groq';
import { OllamaProvider } from '@/ai/providers/ollama';
import { OpenAIProvider } from '@/ai/providers/openai';
import { headerValue, jsonResponse, stubFetch } from '../helpers/http';

describe('the OpenAI dialect catalogue', () => {
  it('reads ids from data[].id, sorted and de-duplicated', async () => {
    const calls = stubFetch([
      jsonResponse({
        data: [
          { id: 'gpt-5.6-terra' },
          { id: 'gpt-5.6-luna' },
          { id: 'gpt-5.6-terra' },
        ],
      }),
    ]);
    const provider = new OpenAIProvider({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-5.6-terra',
    });

    await expect(provider.listModels()).resolves.toEqual([
      'gpt-5.6-luna',
      'gpt-5.6-terra',
    ]);

    const call = calls[0]!;
    expect(call.url).toBe('https://api.openai.com/v1/models');
    expect(call.init.method).toBe('GET');
    // A GET carrying a body is rejected outright by fetch.
    expect(call.init.body).toBeUndefined();
    expect(headerValue(call, 'Authorization')).toBe('Bearer sk-test');
  });

  it('covers Groq through the same implementation', async () => {
    const calls = stubFetch([
      jsonResponse({ data: [{ id: 'openai/gpt-oss-120b' }] }),
    ]);
    const provider = new GroqProvider({
      provider: 'groq',
      apiKey: 'gsk-test',
      model: 'openai/gpt-oss-120b',
    });

    await expect(provider.listModels()).resolves.toEqual([
      'openai/gpt-oss-120b',
    ]);
    expect(calls[0]!.url).toBe('https://api.groq.com/openai/v1/models');
  });

  it('surfaces an unauthorized key rather than an empty list', async () => {
    stubFetch([jsonResponse({ error: 'nope' }, { status: 401 })]);
    const provider = new OpenAIProvider({
      provider: 'openai',
      apiKey: 'bad',
      model: 'm',
    });

    await expect(provider.listModels()).rejects.toMatchObject({
      code: 'INVALID_API_KEY',
    });
  });
});

describe('the Anthropic catalogue', () => {
  it('sends the browser-access headers and reads data[].id', async () => {
    const calls = stubFetch([
      jsonResponse({ data: [{ id: 'claude-sonnet-5' }] }),
    ]);
    const provider = new AnthropicProvider({
      provider: 'anthropic',
      apiKey: 'sk-ant',
      model: 'claude-sonnet-5',
    });

    await expect(provider.listModels()).resolves.toEqual(['claude-sonnet-5']);

    const call = calls[0]!;
    expect(call.url).toBe('https://api.anthropic.com/v1/models');
    expect(headerValue(call, 'x-api-key')).toBe('sk-ant');
    expect(headerValue(call, 'anthropic-dangerous-direct-browser-access')).toBe(
      'true',
    );
  });

  it('refuses to call without a key', async () => {
    const provider = new AnthropicProvider({
      provider: 'anthropic',
      apiKey: '',
      model: 'm',
    });

    await expect(provider.listModels()).rejects.toMatchObject({
      code: 'INVALID_API_KEY',
    });
  });
});

describe('the Gemini catalogue', () => {
  /**
   * Two corrections no other provider needs: the `models/` prefix is not part of
   * the id the API expects, and the list carries models a rewrite cannot use.
   */
  it('strips the prefix and keeps only what can generate content', async () => {
    const calls = stubFetch([
      jsonResponse({
        models: [
          {
            name: 'models/gemini-3.7-flash',
            supportedGenerationMethods: ['generateContent', 'countTokens'],
          },
          {
            name: 'models/gemini-embedding-2',
            supportedGenerationMethods: ['embedContent'],
          },
          { name: 'models/no-methods-declared' },
        ],
      }),
    ]);
    const provider = new GeminiProvider({
      provider: 'gemini',
      apiKey: 'AIza-secret',
      model: 'gemini-3.7-flash',
    });

    await expect(provider.listModels()).resolves.toEqual(['gemini-3.7-flash']);

    const call = calls[0]!;
    expect(headerValue(call, 'x-goog-api-key')).toBe('AIza-secret');
    // A key in the query string ends up in server, proxy and net-export logs.
    expect(call.url).not.toContain('AIza-secret');
  });
});

describe('the Ollama catalogue', () => {
  it('lists what is actually pulled locally', async () => {
    const calls = stubFetch([
      jsonResponse({ models: [{ name: 'qwen3:8b' }, { name: 'llama3.2' }] }),
    ]);
    const provider = new OllamaProvider({
      provider: 'ollama',
      model: 'llama3.2',
      baseUrl: 'http://localhost:11434',
    });

    await expect(provider.listModels()).resolves.toEqual([
      'llama3.2',
      'qwen3:8b',
    ]);
    expect(calls[0]!.url).toBe('http://localhost:11434/api/tags');
  });

  it('says Ollama is unreachable rather than reporting no models', async () => {
    stubFetch([new TypeError('Failed to fetch')]);
    const provider = new OllamaProvider({
      provider: 'ollama',
      model: 'llama3.2',
      baseUrl: 'http://localhost:11434',
    });

    await expect(provider.listModels()).rejects.toMatchObject({
      code: 'OFFLINE',
    });
  });
});

/**
 * A shape change must produce an empty list, never `[undefined]` — the whole
 * reason parsing goes through the `dig` helpers rather than casting.
 */
describe('a malformed catalogue', () => {
  it.each([
    ['a missing list', {}],
    ['the wrong type', { data: 'not-an-array' }],
    ['entries without ids', { data: [{ name: 'no-id-here' }, {}] }],
    ['null entries', { data: [null, 42] }],
  ])('yields nothing for %s', async (_label, body) => {
    stubFetch([jsonResponse(body)]);
    const provider = new OpenAIProvider({
      provider: 'openai',
      apiKey: 'k',
      model: 'm',
    });

    await expect(provider.listModels()).resolves.toEqual([]);
  });
});
