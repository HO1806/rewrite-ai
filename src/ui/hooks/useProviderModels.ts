/**
 * Asks the provider which models this key can actually use.
 *
 * The hardcoded list in `PROVIDERS` is a starting point that goes stale — Groq
 * retired both of its entries two months after announcing them — so the catalogue
 * is fetched on demand and replaces the presets when it arrives.
 *
 * The request goes to the service worker rather than being issued here: it is the
 * process that talks to providers, and it already holds the host permissions.
 */

import { useCallback, useEffect, useState } from 'react';
import { listModelsResponseSchema } from '@/background/messages';
import { getErrorMessage } from '@/shared/errors';
import type { Settings } from '@/storage/settings';

type Draft = Pick<Settings, 'provider' | 'apiKey' | 'model' | 'baseUrl'>;

interface ProviderModels {
  /** Fetched ids, or null when nothing has been loaded for this provider. */
  models: string[] | null;
  isLoading: boolean;
  error: string | null;
  load: () => void;
}

export function useProviderModels(draft: Draft): ProviderModels {
  const [models, setModels] = useState<string[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A catalogue belongs to one provider, so switching providers discards it
  // rather than showing OpenAI's models under Groq.
  useEffect(() => {
    setModels(null);
    setError(null);
  }, [draft.provider]);

  const load = useCallback(() => {
    setIsLoading(true);
    setError(null);

    chrome.runtime
      .sendMessage({ type: 'LIST_MODELS', settings: draft })
      .then((raw: unknown) => {
        const parsed = listModelsResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setError('The extension returned an unexpected response.');
          return;
        }
        if (!parsed.data.ok) {
          setError(parsed.data.message);
          return;
        }
        // An empty catalogue is a real answer, and saying so beats a silent no-op.
        setModels(parsed.data.models);
        if (parsed.data.models.length === 0) {
          setError('The provider returned no models for this key.');
        }
      })
      .catch((err: unknown) => setError(getErrorMessage(err)))
      .finally(() => setIsLoading(false));
  }, [draft]);

  return { models, isLoading, error, load };
}
