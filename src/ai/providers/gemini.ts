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
import { digString } from '../json';
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

  async *rewrite(
    text: string,
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
        contents: [{ role: 'user', parts: [{ text }] }],
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
