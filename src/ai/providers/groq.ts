import type { ConfigFor } from '../types';
import { OpenAICompatibleProvider } from './base';

export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

export class GroqProvider extends OpenAICompatibleProvider {
  readonly name = 'Groq';

  constructor(config: ConfigFor<'groq'>) {
    super(config.apiKey, config.model, GROQ_BASE_URL);
  }
}
