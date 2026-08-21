/**
 * The provider configuration form.
 *
 * One component for both the popup and the options page. They previously each
 * rendered the same seven fields with independent state, and had drifted in six
 * observable ways — the dropdowns listed providers in different orders with
 * different labels, drew defaults from two separate tables, and disagreed about
 * whether switching provider should clear a configured base URL. That last
 * disagreement was a credential-leak path: the popup preserved a custom base URL
 * across a switch to OpenAI, so the OpenAI key went to the custom host.
 */

import { useState } from 'react';
import { PROVIDERS, getProvider } from '@/shared/constants';
import type { ProviderType } from '@/shared/types';
import { Settings, isAllowedBaseUrl } from '@/storage/settings';
import { useProviderModels } from './hooks/useProviderModels';

interface ProviderSettingsFormProps {
  settings: Settings;
  onChange: (partial: Partial<Settings>) => void;
  /** The popup hides the less-used fields; options shows everything. */
  variant?: 'compact' | 'full';
}

export function ProviderSettingsForm({
  settings,
  onChange,
  variant = 'full',
}: ProviderSettingsFormProps) {
  const [isKeyVisible, setIsKeyVisible] = useState(false);
  const descriptor = getProvider(settings.provider);
  const { models, isLoading, error, load } = useProviderModels(settings);
  // The provider's own catalogue when we have it; the bundled list is only ever
  // a guess about a world that changes without telling us.
  const offered = models ?? descriptor.models;
  const isBaseUrlValid = isAllowedBaseUrl(settings.baseUrl);

  /**
   * Switching provider resets the model to that provider's default and drops
   * any base URL the new provider does not use.
   */
  const handleProviderChange = (provider: ProviderType) => {
    const next = getProvider(provider);
    onChange({
      provider,
      model: next.models[0],
      baseUrl: next.needsBaseUrl ? (next.defaultBaseUrl ?? '') : '',
    });
  };

  return (
    <>
      <div className="field">
        <label className="field__label" htmlFor="provider">
          AI provider
        </label>
        <select
          id="provider"
          className="select"
          value={settings.provider}
          onChange={(event) =>
            handleProviderChange(event.target.value as ProviderType)
          }
        >
          {PROVIDERS.map((provider) => (
            <option key={provider.value} value={provider.value}>
              {provider.label}
            </option>
          ))}
        </select>
      </div>

      {descriptor.needsApiKey && (
        <div className="field">
          <label className="field__label" htmlFor="api-key">
            API key
          </label>
          <div className="input-group">
            <input
              id="api-key"
              className="input"
              type={isKeyVisible ? 'text' : 'password'}
              value={settings.apiKey}
              placeholder="Paste your key"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => onChange({ apiKey: event.target.value })}
            />
            <button
              type="button"
              className="button button--subtle"
              onClick={() => setIsKeyVisible((visible) => !visible)}
              aria-pressed={isKeyVisible}
            >
              {isKeyVisible ? 'Hide' : 'Show'}
            </button>
          </div>
          {descriptor.apiKeyUrl && (
            <span className="field__hint">
              Get a key at{' '}
              <a
                className="link"
                href={descriptor.apiKeyUrl}
                target="_blank"
                rel="noreferrer"
              >
                {new URL(descriptor.apiKeyUrl).hostname}
              </a>
            </span>
          )}
        </div>
      )}

      {descriptor.needsBaseUrl && (
        <div className="field">
          <label className="field__label" htmlFor="base-url">
            Base URL
          </label>
          <input
            id="base-url"
            className="input"
            type="url"
            value={settings.baseUrl}
            placeholder={descriptor.defaultBaseUrl ?? 'https://…'}
            spellCheck={false}
            aria-invalid={!isBaseUrlValid}
            aria-describedby={isBaseUrlValid ? undefined : 'base-url-error'}
            onChange={(event) => onChange({ baseUrl: event.target.value })}
          />
          {isBaseUrlValid ? (
            <span className="field__hint">
              Your API key is sent to this host. Only https is accepted, or http
              on localhost.
            </span>
          ) : (
            <span className="field__error" id="base-url-error" role="alert">
              Must be an https URL, or an http URL on localhost.
            </span>
          )}
        </div>
      )}

      <div className="field">
        <label className="field__label" htmlFor="model">
          Model
        </label>
        <input
          id="model"
          className="input"
          value={settings.model}
          spellCheck={false}
          onChange={(event) => onChange({ model: event.target.value })}
        />
        <div className="chips">
          {offered.map((model) => (
            <button
              type="button"
              key={model}
              className="chip"
              aria-pressed={settings.model === model}
              onClick={() => onChange({ model })}
            >
              {model}
            </button>
          ))}
        </div>
        <div className="row">
          <button
            type="button"
            className="button button--subtle"
            onClick={load}
            disabled={isLoading}
          >
            {isLoading ? 'Loading models…' : 'Load models'}
          </button>
          <span className="field__hint">
            {models
              ? `${models.length} from ${descriptor.label}`
              : 'Ask the provider what this key can use'}
          </span>
        </div>
        {error && (
          <span className="field__error" role="alert">
            {error}
          </span>
        )}
      </div>

      <div className="field">
        <label className="field__label" htmlFor="temperature">
          Creativity
        </label>
        <div className="range-row">
          <input
            id="temperature"
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={settings.temperature}
            onChange={(event) =>
              onChange({ temperature: Number(event.target.value) })
            }
          />
          <span className="range-row__value">
            {settings.temperature.toFixed(2)}
          </span>
        </div>
        <span className="field__hint">
          Lower is more literal, higher is more inventive.
        </span>
      </div>

      {variant === 'full' && (
        <>
          <div className="field">
            <label className="field__label" htmlFor="max-tokens">
              Response limit (tokens)
            </label>
            <input
              id="max-tokens"
              className="input"
              type="number"
              min={1}
              max={128000}
              value={settings.maxTokens}
              onChange={(event) =>
                onChange({ maxTokens: Number(event.target.value) })
              }
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="translate-language">
              Translate into
            </label>
            <input
              id="translate-language"
              className="input"
              value={settings.translateLanguage}
              onChange={(event) =>
                onChange({ translateLanguage: event.target.value })
              }
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="theme">
              Appearance
            </label>
            <select
              id="theme"
              className="select"
              value={settings.theme}
              onChange={(event) =>
                onChange({ theme: event.target.value as Settings['theme'] })
              }
            >
              <option value="system">Match system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </>
      )}

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={settings.stream}
          onChange={(event) => onChange({ stream: event.target.checked })}
        />
        <span className="checkbox-row__text">
          <span>Stream the response</span>
          <span className="field__hint">Show text as it is generated.</span>
        </span>
      </label>
    </>
  );
}
