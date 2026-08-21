/**
 * Settings schema and persistence.
 *
 * Uses Zod for runtime validation so corrupt or manually-edited storage
 * values never crash the extension. Falls back to defaults for any
 * invalid field.
 */

import { z } from 'zod';
import { getStorage, setStorage, onStorageChange } from './index';
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '@/shared/constants';

/**
 * Base URL validation.
 *
 * An unvalidated base URL is a credential-exfiltration path: any provider that
 * honours one will attach the user's API key to a request against whatever host
 * is stored. Only https is accepted, with plain http allowed for loopback so
 * local model servers still work.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isAllowedBaseUrl(value: string): boolean {
  if (value === '') return true;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

/** Zod schema for the settings object */
export const settingsSchema = z.object({
  provider: z.enum([
    'openai',
    'groq',
    'gemini',
    'openrouter',
    'anthropic',
    'ollama',
    'custom',
  ]),
  apiKey: z.string(),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(1).max(128_000),
  stream: z.boolean(),
  theme: z.enum(['light', 'dark', 'system']),
  baseUrl: z
    .string()
    .refine(
      isAllowedBaseUrl,
      'Must be an https URL, or an http URL on localhost.',
    ),
  translateLanguage: z.string().min(1),
  /**
   * The tab the card was last on, so the shortcut reopens where you left off.
   * Written by the stream handler whenever a rewrite runs, which is also what
   * switching tabs in the card does.
   */
  lastAction: z.enum(['improve', 'translate']),
});

/** Inferred TypeScript type from the Zod schema */
export type Settings = z.infer<typeof settingsSchema>;

function defaults(): Settings {
  return settingsSchema.parse({ ...DEFAULT_SETTINGS });
}

/**
 * Load settings from storage with validation.
 * Any missing or invalid fields fall back to defaults.
 */
export async function loadSettings(): Promise<Settings> {
  const raw = await getStorage<unknown>(STORAGE_KEYS.SETTINGS);

  if (!raw || typeof raw !== 'object') {
    const initial = defaults();
    await setStorage(STORAGE_KEYS.SETTINGS, initial);
    return initial;
  }

  // Merge stored values over defaults, then validate
  const merged = { ...DEFAULT_SETTINGS, ...(raw as Record<string, unknown>) };
  const result = settingsSchema.safeParse(merged);

  if (result.success) {
    return result.data;
  }

  // If validation fails, self-heal by overwriting storage with valid defaults.
  // Only the failing field paths are reported — never the values, which would
  // put the API key in the console.
  console.warn(
    '[Rewrite AI] Invalid stored settings; resetting to defaults. Invalid fields:',
    result.error.issues.map((issue) => issue.path.join('.')).join(', '),
  );

  const healed = defaults();
  await setStorage(STORAGE_KEYS.SETTINGS, healed);
  return healed;
}

/**
 * Save settings to storage after validation.
 * Throws if the settings object is invalid.
 */
export async function saveSettings(settings: Settings): Promise<void> {
  const validated = settingsSchema.parse(settings);
  await setStorage(STORAGE_KEYS.SETTINGS, validated);
}

/**
 * Update a subset of settings fields.
 * Loads current settings, merges the partial update, validates, and saves.
 */
export async function updateSettings(
  partial: Partial<Settings>,
): Promise<Settings> {
  const current = await loadSettings();
  const validated = settingsSchema.parse({ ...current, ...partial });
  await setStorage(STORAGE_KEYS.SETTINGS, validated);
  return validated;
}

/**
 * Subscribe to settings changes.
 * Returns an unsubscribe function.
 */
export function onSettingsChange(
  callback: (settings: Settings) => void,
): () => void {
  return onStorageChange<unknown>(STORAGE_KEYS.SETTINGS, (newValue) => {
    if (!newValue) return;
    const merged = {
      ...DEFAULT_SETTINGS,
      ...(newValue as Record<string, unknown>),
    };
    const result = settingsSchema.safeParse(merged);
    if (result.success) {
      callback(result.data);
    }
  });
}
