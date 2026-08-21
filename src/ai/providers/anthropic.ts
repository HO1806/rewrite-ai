import {
  AIProvider,
  AIProviderError,
  ConfigFor,
  RewriteOptions,
} from '../types';
import {
  StreamHandlers,
  assertResponseOk,
  extractAnthropicDelta,
  extractStandardError,
  parseSSEStream,
  readJsonBody,
} from '../stream';
import { collectModelIds, digString } from '../json';
import { requestJson } from './base';

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

const STREAM_HANDLERS: StreamHandlers = {
  extractDelta: extractAnthropicDelta,
  extractError: extractStandardError,
};

export class AnthropicProvider implements AIProvider {
  readonly name = 'Anthropic Claude';

  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: ConfigFor<'anthropic'>) {
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    if (!this.apiKey) {
      throw new AIProviderError(
        'Anthropic API key is required.',
        'INVALID_API_KEY',
      );
    }

    const response = await requestJson({
      endpoint: `${ANTHROPIC_BASE_URL}/models`,
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        // Required for a browser-origin request, exactly as in `rewrite`.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      method: 'GET',
      signal,
    });
    await assertResponseOk(response, this.name);

    return collectModelIds(
      await readJsonBody(response, this.name),
      'data',
      'id',
    );
  }

  async *rewrite(
    userContent: string,
    systemPrompt: string,
    options: RewriteOptions,
  ): AsyncGenerator<string, void, unknown> {
    if (!this.apiKey) {
      throw new AIProviderError(
        'Anthropic API key is required.',
        'INVALID_API_KEY',
      );
    }

    const response = await requestJson({
      endpoint: `${ANTHROPIC_BASE_URL}/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        // The correctly-prefixed header. The unprefixed spelling this once used
        // is not recognised by the API and is rejected at CORS preflight.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      payload: {
        model: this.model,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        stream: options.stream,
      },
      signal: options.signal,
    });

    if (!options.stream) {
      await assertResponseOk(response, this.name);
      const data = await readJsonBody(response, this.name);
      yield digString(data, 'content', 0, 'text') ?? '';
      return;
    }

    yield* parseSSEStream(response, this.name, STREAM_HANDLERS, options.signal);
  }
}
