import { describe, expect, it } from 'vitest';
import { buildProviderConfig, createProvider } from '@/ai/factory';
import { AIProviderError, type ProviderConfig } from '@/ai/types';
import { settingsSchema, type Settings } from '@/storage/settings';
import { DEFAULT_SETTINGS } from '@/shared/constants';

function settings(overrides: Partial<Settings> = {}): Settings {
  return settingsSchema.parse({ ...DEFAULT_SETTINGS, ...overrides });
}

describe('createProvider', () => {
  it.each<[ProviderConfig, string]>([
    [{ provider: 'openai', apiKey: 'k', model: 'm' }, 'OpenAI'],
    [{ provider: 'groq', apiKey: 'k', model: 'm' }, 'Groq'],
    [{ provider: 'gemini', apiKey: 'k', model: 'm' }, 'Google Gemini'],
    [{ provider: 'openrouter', apiKey: 'k', model: 'm' }, 'OpenRouter'],
    [{ provider: 'anthropic', apiKey: 'k', model: 'm' }, 'Anthropic Claude'],
    [
      { provider: 'ollama', model: 'm', baseUrl: 'http://localhost:11434' },
      'Ollama',
    ],
    [
      {
        provider: 'custom',
        apiKey: 'k',
        model: 'm',
        baseUrl: 'https://x.dev/v1',
      },
      'Custom server',
    ],
  ])('builds the %s provider', (config, expectedName) => {
    expect(createProvider(config).name).toBe(expectedName);
  });

  it('throws for an unrecognised provider', () => {
    const bogus = {
      provider: 'telepathy',
      apiKey: 'k',
      model: 'm',
    } as unknown as ProviderConfig;
    expect(() => createProvider(bogus)).toThrow(AIProviderError);
  });
});

describe('buildProviderConfig', () => {
  it('omits the base URL for providers that do not use one', () => {
    const config = buildProviderConfig(
      settings({ provider: 'groq', baseUrl: 'https://evil.test' }),
    );
    expect(config).toEqual({
      provider: 'groq',
      apiKey: '',
      model: DEFAULT_SETTINGS.model,
    });
  });

  /**
   * The credential-leak path this guards: a base URL left over from a custom
   * provider must not travel with an OpenAI key.
   */
  it.each(['groq', 'gemini', 'anthropic', 'openrouter'] as const)(
    'never forwards a stored base URL to %s',
    (provider) => {
      const config = buildProviderConfig(
        settings({ provider, baseUrl: 'https://evil.test' }),
      );
      expect(config).not.toHaveProperty('baseUrl');
    },
  );

  it('passes a base URL through for openai when one is set', () => {
    const config = buildProviderConfig(
      settings({ provider: 'openai', baseUrl: 'https://proxy.test/v1' }),
    );
    expect(config).toMatchObject({
      provider: 'openai',
      baseUrl: 'https://proxy.test/v1',
    });
  });

  it('omits an empty base URL for openai so the default host applies', () => {
    expect(
      buildProviderConfig(settings({ provider: 'openai', baseUrl: '' })),
    ).not.toHaveProperty('baseUrl');
  });

  /**
   * Previously `custom` with no base URL fell through to OpenAIProvider, which
   * defaults to api.openai.com — sending a self-hosted key to OpenAI.
   */
  it('refuses a custom provider with no base URL', () => {
    expect(() =>
      buildProviderConfig(settings({ provider: 'custom', baseUrl: '' })),
    ).toThrow(/base URL is required/i);
  });

  it('defaults the Ollama host and drops the API key', () => {
    const config = buildProviderConfig(
      settings({
        provider: 'ollama',
        apiKey: 'should-not-travel',
        baseUrl: '',
      }),
    );
    expect(config).toEqual({
      provider: 'ollama',
      model: DEFAULT_SETTINGS.model,
      baseUrl: 'http://localhost:11434',
    });
    expect(config).not.toHaveProperty('apiKey');
  });
});
