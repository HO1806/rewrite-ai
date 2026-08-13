import type { ConfigFor } from '../types';
import { OpenAICompatibleProvider } from './base';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

export class OpenAIProvider extends OpenAICompatibleProvider {
  readonly name = 'OpenAI';

  constructor(config: ConfigFor<'openai'>) {
    super(config.apiKey, config.model, config.baseUrl || OPENAI_BASE_URL);
  }

  /** A local OpenAI-compatible server (llama.cpp, LM Studio) needs no key. */
  protected override requiresApiKey(): boolean {
    return !isLoopback(this.baseUrl);
  }
}

/**
 * A user-supplied OpenAI-compatible endpoint.
 *
 * Kept distinct from OpenAIProvider so its display name is honest and so the
 * type system can require a baseUrl — `custom` with an empty baseUrl used to
 * fall through to api.openai.com and send a self-hosted key to OpenAI.
 */
export class CustomOpenAIProvider extends OpenAICompatibleProvider {
  readonly name = 'Custom server';

  constructor(config: ConfigFor<'custom'>) {
    super(config.apiKey, config.model, config.baseUrl);
  }

  protected override requiresApiKey(): boolean {
    return false;
  }
}

function isLoopback(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]'
    );
  } catch {
    return false;
  }
}
