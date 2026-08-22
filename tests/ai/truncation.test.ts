/**
 * Running out of room, reported rather than hidden.
 *
 * Every dialect signals this differently and none of them calls it an error, so
 * a rewrite cut off by the token limit used to arrive mid-sentence looking like
 * the model's considered answer. Gemini's error extractor even whitelists
 * `MAX_TOKENS` explicitly.
 *
 * These also cover the other half of the same problem: a *missing* content path
 * is a malformed response, not an empty rewrite.
 */

import { describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '@/ai/providers/anthropic';
import { GeminiProvider } from '@/ai/providers/gemini';
import { OllamaProvider } from '@/ai/providers/ollama';
import { OpenAIProvider } from '@/ai/providers/openai';
import type { RewriteOptions } from '@/ai/types';
import { collect, jsonResponse, sseResponse, stubFetch } from '../helpers/http';

const STREAMED: RewriteOptions = {
  temperature: 0.3,
  maxTokens: 64,
  stream: true,
};
const WHOLE: RewriteOptions = { ...STREAMED, stream: false };

const openai = () =>
  new OpenAIProvider({ provider: 'openai', apiKey: 'k', model: 'm' });

describe('a stream that stops at the token limit', () => {
  it('reports truncation and keeps the text', async () => {
    stubFetch([
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Half a sen' } }] })}`,
        `data: ${JSON.stringify({ choices: [{ finish_reason: 'length' }] })}`,
        'data: [DONE]',
      ]),
    ]);
    const onTruncated = vi.fn();

    await expect(
      collect(openai().rewrite('t', 's', { ...STREAMED, onTruncated })),
    ).resolves.toEqual(['Half a sen']);

    expect(onTruncated).toHaveBeenCalled();
  });

  it('stays quiet when the model finished on its own', async () => {
    stubFetch([
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Done.' } }] })}`,
        `data: ${JSON.stringify({ choices: [{ finish_reason: 'stop' }] })}`,
        'data: [DONE]',
      ]),
    ]);
    const onTruncated = vi.fn();

    await collect(openai().rewrite('t', 's', { ...STREAMED, onTruncated }));

    expect(onTruncated).not.toHaveBeenCalled();
  });

  it.each([
    [
      'Anthropic',
      () =>
        new AnthropicProvider({
          provider: 'anthropic',
          apiKey: 'k',
          model: 'm',
        }),
      [
        `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: 'Half' } })}`,
        `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } })}`,
      ],
    ],
    [
      'Gemini',
      () => new GeminiProvider({ provider: 'gemini', apiKey: 'k', model: 'm' }),
      [
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Half' }] } }] })}`,
        `data: ${JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS' }] })}`,
      ],
    ],
  ])('%s reports it too', async (_label, make, frames) => {
    stubFetch([sseResponse(frames)]);
    const onTruncated = vi.fn();

    await collect(make().rewrite('t', 's', { ...STREAMED, onTruncated }));

    expect(onTruncated).toHaveBeenCalled();
  });

  it('Ollama reports it from its final NDJSON frame', async () => {
    stubFetch([
      new Response(
        [
          JSON.stringify({ response: 'Half' }),
          JSON.stringify({ done: true, done_reason: 'length' }),
        ].join('\n'),
        { status: 200 },
      ),
    ]);
    const onTruncated = vi.fn();
    const provider = new OllamaProvider({
      provider: 'ollama',
      model: 'm',
      baseUrl: 'http://localhost:11434',
    });

    await collect(provider.rewrite('t', 's', { ...STREAMED, onTruncated }));

    expect(onTruncated).toHaveBeenCalled();
  });

  it('reports it on the non-streaming path as well', async () => {
    stubFetch([
      jsonResponse({
        choices: [{ message: { content: 'Half' }, finish_reason: 'length' }],
      }),
    ]);
    const onTruncated = vi.fn();

    await collect(openai().rewrite('t', 's', { ...WHOLE, onTruncated }));

    expect(onTruncated).toHaveBeenCalled();
  });
});

/**
 * `?? ''` used to stand here, so a refusal — OpenAI returns `content: null` and
 * puts the reason in `refusal` — became a successful, empty rewrite.
 */
describe('a response with no content path', () => {
  it('fails rather than returning an empty rewrite', async () => {
    stubFetch([
      jsonResponse({ choices: [{ message: { refusal: 'I cannot help.' } }] }),
    ]);

    await expect(
      collect(openai().rewrite('t', 's', WHOLE)),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
  });

  it('still allows a genuinely empty string through', async () => {
    stubFetch([jsonResponse({ choices: [{ message: { content: '' } }] })]);

    await expect(collect(openai().rewrite('t', 's', WHOLE))).resolves.toEqual([
      '',
    ]);
  });
});
