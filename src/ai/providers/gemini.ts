import {
  AIProvider,
  AIProviderError,
  ConfigFor,
  RewriteOptions,
} from '../types';
import {
  StreamHandlers,
  assertResponseOk,
  extractGeminiError,
  parseSSEStream,
  readJsonBody,
} from '../stream';
import { dig, digString } from '../json';
import { requestJson } from './base';

export const GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta';

const STREAM_HANDLERS: StreamHandlers = {
  extractDelta: (frame) =>
    digString(frame, 'candidates', 0, 'content', 'parts', 0, 'text') ?? null,
  extractError: extractGeminiError,
};

export class GeminiProvider implements AIProvider {
  readonly name = 'Google Gemini';

  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: ConfigFor<'gemini'>) {
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  /**
   * Gemini's catalogue needs two corrections the others do not.
   *
   * Entries are named `models/gemini-…`, and the id the API expects has no
   * prefix. The list also carries embedding, ranking and tuning models a rewrite
   * cannot use, so it is filtered by the capability each entry declares rather
   * than by guessing from the name.
   */
  async listModels(signal?: AbortSignal): Promise<string[]> {
    if (!this.apiKey) {
      throw new AIProviderError(
        'Gemini API key is required.',
        'INVALID_API_KEY',
      );
    }

    const response = await requestJson({
      endpoint: `${GEMINI_BASE_URL}/models?pageSize=200`,
      headers: { 'x-goog-api-key': this.apiKey },
      method: 'GET',
      signal,
    });
    await assertResponseOk(response, this.name);

    const entries = dig(await readJsonBody(response, this.name), 'models');
    if (!Array.isArray(entries)) return [];

    const ids = new Set<string>();
    for (const entry of entries) {
      const name = digString(entry, 'name');
      const methods = dig(entry, 'supportedGenerationMethods');
      if (!name || !Array.isArray(methods)) continue;
      if (!methods.includes('generateContent')) continue;

      ids.add(name.startsWith('models/') ? name.slice('models/'.length) : name);
    }

    return [...ids].sort();
  }

  async *rewrite(
    userContent: string,
    systemPrompt: string,
    options: RewriteOptions,
  ): AsyncGenerator<string, void, unknown> {
    if (!this.apiKey) {
      throw new AIProviderError(
        'Gemini API key is required.',
        'INVALID_API_KEY',
      );
    }

    // The model is user-supplied, so it is encoded rather than interpolated raw.
    const model = encodeURIComponent(this.model);
    const method = options.stream
      ? 'streamGenerateContent?alt=sse'
      : 'generateContent';
    const endpoint = `${GEMINI_BASE_URL}/models/${model}:${method}`;

    const response = await requestJson({
      endpoint,
      headers: {
        'Content-Type': 'application/json',
        // Sent as a header, not a `?key=` query parameter — a key in the URL
        // ends up in server logs, proxy logs and chrome://net-export captures.
        'x-goog-api-key': this.apiKey,
      },
      payload: {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userContent }] }],
        generationConfig: {
          temperature: options.temperature,
          maxOutputTokens: options.maxTokens,
        },
      },
      signal: options.signal,
    });

    if (!options.stream) {
      await assertResponseOk(response, this.name);
      const data = await readJsonBody(response, this.name);

      const blocked = extractGeminiError(data);
      if (blocked) {
        throw new AIProviderError(`${this.name}: ${blocked}`, 'PROVIDER_ERROR');
      }

      yield digString(data, 'candidates', 0, 'content', 'parts', 0, 'text') ??
        '';
      return;
    }

    yield* parseSSEStream(response, this.name, STREAM_HANDLERS, options.signal);
  }
}
