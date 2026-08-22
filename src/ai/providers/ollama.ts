import { AIProvider, ConfigFor, RewriteOptions } from '../types';
import {
  StreamHandlers,
  assertResponseOk,
  extractOllamaError,
  isOllamaTruncated,
  requireContent,
  parseNDJSONStream,
  readJsonBody,
} from '../stream';
import { collectModelIds, dig, digString } from '../json';
import { normalizeBaseUrl, requestJson } from './base';

export const OLLAMA_BASE_URL = 'http://localhost:11434';

const STREAM_HANDLERS: StreamHandlers = {
  extractDelta: (frame) => digString(frame, 'response') ?? null,
  extractError: extractOllamaError,
  isTruncated: isOllamaTruncated,
};

export class OllamaProvider implements AIProvider {
  readonly name = 'Ollama';

  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: ConfigFor<'ollama'>) {
    this.model = config.model;
    this.baseUrl = config.baseUrl;
  }

  /**
   * `GET /api/tags` — what is actually pulled on this machine.
   *
   * The most valuable of the four: a hardcoded list cannot know which models a
   * user has downloaded, so it was guaranteed to be wrong for everyone.
   */
  async listModels(signal?: AbortSignal): Promise<string[]> {
    const response = await requestJson({
      endpoint: `${normalizeBaseUrl(this.baseUrl)}/api/tags`,
      headers: {},
      method: 'GET',
      signal,
      offlineMessage: 'Could not reach Ollama. Is it running?',
    });
    await assertResponseOk(response, this.name);

    return collectModelIds(
      await readJsonBody(response, this.name),
      'models',
      'name',
    );
  }

  async *rewrite(
    userContent: string,
    systemPrompt: string,
    options: RewriteOptions,
  ): AsyncGenerator<string, void, unknown> {
    const response = await requestJson({
      endpoint: `${normalizeBaseUrl(this.baseUrl)}/api/generate`,
      headers: { 'Content-Type': 'application/json' },
      payload: {
        model: this.model,
        system: systemPrompt,
        prompt: userContent,
        stream: options.stream,
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
        },
      },
      signal: options.signal,
      offlineMessage:
        `Cannot reach Ollama at ${this.baseUrl}. Check that it is running, and that ` +
        `OLLAMA_ORIGINS permits requests from browser extensions.`,
    });

    if (!options.stream) {
      await assertResponseOk(response, this.name);
      const data = await readJsonBody(response, this.name);
      if (isOllamaTruncated(data)) options.onTruncated?.();
      yield requireContent(dig(data, 'response'), this.name);
      return;
    }

    yield* parseNDJSONStream(
      response,
      this.name,
      STREAM_HANDLERS,
      options.signal,
      options.onTruncated,
    );
  }
}
