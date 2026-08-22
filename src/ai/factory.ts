import type { ProviderType } from '@/shared/types';
import { getProvider } from '@/shared/constants';
import type { Settings } from '@/storage/settings';
import { AIProvider, AIProviderError, ProviderConfig } from './types';
import { CustomOpenAIProvider, OpenAIProvider } from './providers/openai';
import { GroqProvider } from './providers/groq';
import { GeminiProvider } from './providers/gemini';
import { OpenRouterProvider } from './providers/openrouter';
import { AnthropicProvider } from './providers/anthropic';
import { OLLAMA_BASE_URL, OllamaProvider } from './providers/ollama';

/**
 * Build a provider from its config.
 *
 * The config carries its own discriminant, so each branch receives a shape the
 * type system has already narrowed — a mismatched pairing such as an Ollama
 * config with an API key no longer compiles.
 */
export function createProvider(config: ProviderConfig): AIProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'custom':
      return new CustomOpenAIProvider(config);
    case 'groq':
      return new GroqProvider(config);
    case 'gemini':
      return new GeminiProvider(config);
    case 'openrouter':
      return new OpenRouterProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    default:
      return assertNeverProvider(config);
  }
}

/**
 * Translate stored settings into a provider config.
 *
 * `baseUrl` is deliberately only read for the providers that use one. Carrying
 * it across a provider switch is how a stale custom endpoint could end up
 * receiving an OpenAI key.
 */
export function buildProviderConfig(settings: Settings): ProviderConfig {
  const { provider, apiKey, model } = settings;

  switch (provider) {
    case 'openai':
      return {
        provider,
        apiKey,
        model,
        /**
         * Honoured only where the provider actually uses one. The options form
         * clears `baseUrl` when you switch to a provider that does not need it,
         * so a leftover value can now only arrive by storage corruption — and
         * this is the choke point where it would otherwise redirect a request
         * carrying the user's key.
         */
        ...(settings.baseUrl && getProvider(provider).needsBaseUrl
          ? { baseUrl: settings.baseUrl }
          : {}),
      };
    case 'custom': {
      if (!settings.baseUrl) {
        throw new AIProviderError(
          'A base URL is required for a custom server. Set one in the extension options.',
          'PROVIDER_ERROR',
        );
      }
      return { provider, apiKey, model, baseUrl: settings.baseUrl };
    }
    case 'ollama':
      return { provider, model, baseUrl: settings.baseUrl || OLLAMA_BASE_URL };
    case 'groq':
    case 'gemini':
    case 'anthropic':
      return { provider, apiKey, model };
    case 'openrouter':
      return { provider, apiKey, model };
    default:
      return assertNeverProvider(provider);
  }
}

/** Exhaustiveness guard: adding a ProviderType without handling it fails to compile. */
function assertNeverProvider(value: never): never {
  const provider =
    (value as { provider?: ProviderType }).provider ?? String(value);
  throw new AIProviderError(
    `Unsupported provider: ${provider}`,
    'PROVIDER_ERROR',
  );
}
