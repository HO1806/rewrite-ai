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

  // Merge stored values over defaults, then validate.
  const merged = { ...DEFAULT_SETTINGS, ...(raw as Record<string, unknown>) };
  const result = settingsSchema.safeParse(merged);

  if (result.success) {
    return result.data;
  }

  /**
   * Heal only the fields that failed.
   *
   * This used to replace the whole object, which meant one bad value — a base
   * URL a later refinement tightened, a number outside a narrowed range, a
   * provider id that was removed — silently took the user's **API key** with it.
   * They would find the extension apparently reset itself, with the reason
   * visible only in a console nobody has open.
   *
   * Field paths are logged, never values: the object holds the key.
   */
  const invalid = new Set(
    result.error.issues
      .map((issue) => issue.path[0])
      .filter((key): key is string => typeof key === 'string'),
  );

  console.warn(
    '[Rewrite AI] Invalid stored settings; resetting these fields to defaults:',
    [...invalid].join(', '),
  );

  const repaired: Record<string, unknown> = { ...merged };
  for (const key of invalid) {
    repaired[key] = DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS];
  }

  const second = settingsSchema.safeParse(repaired);
  // A field can fail for a reason its own default cannot fix — a cross-field
  // refinement, or a default that is itself invalid. Falling back whole is right
  // then, because there is nothing left to preserve selectively.
  const healed = second.success ? second.data : defaults();

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
