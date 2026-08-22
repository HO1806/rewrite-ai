/**
 * The catalogue bridge, driven across the real message boundary.
 *
 * The chrome mock routes `runtime.sendMessage` to whatever registered
 * `onMessage`, so these drive the actual handler and the actual provider against
 * a stubbed fetch — the seam that would otherwise be mocked away is the thing
 * being tested.
 */

import { describe, expect, it } from 'vitest';
import { registerModelsBridge } from '@/background/modelsBridge';
import { jsonResponse, stubFetch } from '../helpers/http';

const DRAFT = {
  provider: 'groq' as const,
  apiKey: 'gsk-test',
  model: 'openai/gpt-oss-120b',
  baseUrl: '',
};

function ask(settings: unknown): Promise<unknown> {
  registerModelsBridge();
  return chrome.runtime.sendMessage({ type: 'LIST_MODELS', settings });
}

describe('registerModelsBridge', () => {
  it('returns the provider catalogue', async () => {
    stubFetch([
      jsonResponse({
        data: [{ id: 'openai/gpt-oss-120b' }, { id: 'openai/gpt-oss-20b' }],
      }),
    ]);

    await expect(ask(DRAFT)).resolves.toEqual({
      ok: true,
      models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    });
  });

  /**
   * The credentials come from the form, not from storage, so the button works
   * before the user has saved.
   */
  it('uses the key it was handed rather than the stored one', async () => {
    const calls = stubFetch([jsonResponse({ data: [] })]);

    await ask({ ...DRAFT, apiKey: 'gsk-unsaved' });

    expect(calls[0]!.init.headers).toMatchObject({
      Authorization: 'Bearer gsk-unsaved',
    });
  });

  it('reports a provider failure instead of an empty list', async () => {
    stubFetch([
      jsonResponse({ error: { message: 'bad key' } }, { status: 401 }),
    ]);

    await expect(ask(DRAFT)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('Invalid API key'),
    });
  });

  /**
   * A base URL that is neither https nor loopback would send the user's API key
   * to whatever host it names. The schema refuses it before a fetch happens.
   */
  it('refuses a base URL that could exfiltrate the key', async () => {
    const calls = stubFetch([jsonResponse({ data: [] })]);

    const reply = await ask({
      ...DRAFT,
      provider: 'custom',
      baseUrl: 'http://evil.example.com/v1',
    });

    expect(reply).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  /**
   * The provider is built inside the promise chain, not before it. Built before,
   * a synchronous throw escaped the listener: `return true` never ran, the reply
   * never came, and the caller saw a closed channel instead of the message the
   * factory wrote.
   */
  it('answers with the reason when the config itself is invalid', async () => {
    const calls = stubFetch([jsonResponse({ data: [] })]);

    const reply = await ask({
      ...DRAFT,
      provider: 'custom',
      baseUrl: '',
      model: 'anything',
    });

    expect(reply).toMatchObject({
      ok: false,
      message: expect.stringContaining('base URL'),
    });
    expect(calls).toHaveLength(0);
  });

  it('ignores messages that are not its own', async () => {
    await expect(ask(undefined)).resolves.toBeUndefined();
  });
});
