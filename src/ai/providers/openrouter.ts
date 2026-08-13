import type { ConfigFor } from '../types';
import { OpenAICompatibleProvider } from './base';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export class OpenRouterProvider extends OpenAICompatibleProvider {
  readonly name = 'OpenRouter';

  /**
   * OpenRouter tags requests with the calling app. This used to be hardcoded to
   * the project's own repo URL, labelling every user's traffic as ours; it is
   * now opt-in via config.
   */
  private readonly attribution?: { referer: string; title: string };

  constructor(config: ConfigFor<'openrouter'>) {
    super(config.apiKey, config.model, OPENROUTER_BASE_URL);
    this.attribution = config.attribution;
  }

  protected override extraHeaders(): Record<string, string> {
    if (!this.attribution) return {};
    return {
      'HTTP-Referer': this.attribution.referer,
      'X-Title': this.attribution.title,
    };
  }
}
