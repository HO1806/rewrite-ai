/**
 * Shared constants used across the extension.
 *
 * Everything here is a single source of truth on purpose. Provider labels,
 * default models and action titles were each previously defined in three or
 * four places, and had already drifted: the popup and options dropdowns listed
 * providers in different orders with different labels, and two independent
 * default-model tables disagreed about which model a provider should use.
 */

import type {
  FormatOption,
  LengthOption,
  ProviderType,
  RewriteAction,
  ToneOption,
} from './types';

/** Port name for streaming communication between background and content script */
export const STREAM_PORT_NAME = 'rewrite-ai-stream';

/** Shadow DOM host element ID */
export const SHADOW_HOST_ID = 'rewrite-ai-root';

/** Storage keys */
export const STORAGE_KEYS = {
  SETTINGS: 'rewrite-ai-settings',
} as const;

/* ── Limits ── */

/**
 * Longest selection accepted for a rewrite.
 *
 * The port handler used to forward whatever it was given straight into the
 * provider payload, so a large selection meant an unbounded request and bill.
 */
export const MAX_INPUT_LENGTH = 20_000;

/** How long a single generation may run before it is aborted. */
export const REQUEST_TIMEOUT_MS = 90_000;

/* ── Floating card geometry ── */

/**
 * Card dimensions, in CSS pixels.
 *
 * These were three disagreeing literals (a 460px card clamped against 470 in
 * one code path and 380 in another), which let the card overhang the viewport.
 */
export const CARD = {
  width: 460,
  /** Worst-case height, with the adjust drawer open. Used for edge clamping. */
  maxHeight: 480,
  /** Gap between the selection and the card. */
  offset: 8,
  /** Minimum distance from any viewport edge. */
  margin: 10,
} as const;

/* ── Rewrite actions ── */

export interface ActionDescriptor {
  readonly id: RewriteAction;
  /** Short label, used in context menus and the popup. */
  readonly label: string;
  /** The sentence shown in the card header. */
  readonly cardTitle: string;
}

export const ACTIONS: readonly ActionDescriptor[] = [
  {
    id: 'improve',
    label: 'Improve Writing',
    cardTitle: 'Here is another way of writing this',
  },
  {
    id: 'grammar',
    label: 'Fix Grammar',
    cardTitle: 'Here is a corrected version of this',
  },
  {
    id: 'professional',
    label: 'Make Professional',
    cardTitle: 'Here is a professional version of this',
  },
  {
    id: 'friendly',
    label: 'Make Friendly',
    cardTitle: 'Here is a friendly version of this',
  },
  {
    id: 'concise',
    label: 'Make Concise',
    cardTitle: 'Here is a concise version of this',
  },
  {
    id: 'expand',
    label: 'Expand',
    cardTitle: 'Here is an expanded version of this',
  },
  { id: 'translate', label: 'Translate', cardTitle: 'Here is the translation' },
];

const ACTION_BY_ID = new Map(ACTIONS.map((action) => [action.id, action]));

export function getAction(id: RewriteAction): ActionDescriptor {
  const action = ACTION_BY_ID.get(id);
  if (!action) {
    throw new Error(`Unknown rewrite action: ${id}`);
  }
  return action;
}

/* ── Providers ── */

export interface ProviderDescriptor {
  readonly value: ProviderType;
  readonly label: string;
  readonly needsApiKey: boolean;
  /** Whether the user must supply a base URL for this provider. */
  readonly needsBaseUrl: boolean;
  readonly defaultBaseUrl?: string;
  /** Suggested models; the first entry is the default. */
  readonly models: readonly [string, ...string[]];
  /** Where to obtain an API key. */
  readonly apiKeyUrl?: string;
}

export const PROVIDERS: readonly ProviderDescriptor[] = [
  {
    value: 'openai',
    label: 'OpenAI',
    needsApiKey: true,
    needsBaseUrl: false,
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    apiKeyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    value: 'groq',
    label: 'Groq (ultra fast)',
    needsApiKey: true,
    needsBaseUrl: false,
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    apiKeyUrl: 'https://console.groq.com/keys',
  },
  {
    value: 'gemini',
    label: 'Google Gemini',
    needsApiKey: true,
    needsBaseUrl: false,
    models: ['gemini-1.5-flash', 'gemini-1.5-pro'],
    apiKeyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    value: 'anthropic',
    label: 'Anthropic Claude',
    needsApiKey: true,
    needsBaseUrl: false,
    models: ['claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022'],
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    value: 'openrouter',
    label: 'OpenRouter',
    needsApiKey: true,
    needsBaseUrl: false,
    models: [
      'meta-llama/llama-3.1-8b-instruct:free',
      'anthropic/claude-3.5-haiku',
    ],
    apiKeyUrl: 'https://openrouter.ai/keys',
  },
  {
    value: 'ollama',
    label: 'Ollama (local)',
    needsApiKey: false,
    needsBaseUrl: true,
    defaultBaseUrl: 'http://localhost:11434',
    models: ['llama3.2', 'mistral', 'qwen2.5'],
  },
  {
    value: 'custom',
    label: 'Custom OpenAI-compatible server',
    needsApiKey: false,
    needsBaseUrl: true,
    models: ['gpt-4o-mini'],
  },
];

const PROVIDER_BY_VALUE = new Map(
  PROVIDERS.map((provider) => [provider.value, provider]),
);

export function getProvider(value: ProviderType): ProviderDescriptor {
  const provider = PROVIDER_BY_VALUE.get(value);
  if (!provider) {
    throw new Error(`Unknown provider: ${value}`);
  }
  return provider;
}

export function getDefaultModel(value: ProviderType): string {
  return getProvider(value).models[0];
}

/* ── Adjust drawer options ── */

export interface AdjustOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon: string;
}

/**
 * Labels here must describe what the prompt actually asks for.
 * Two of them previously did the opposite — the pill reading "Funny" sent
 * `neutral`, which instructs the model to be neutral and objective.
 */
export const TONE_OPTIONS: readonly AdjustOption<ToneOption>[] = [
  { value: 'professional', label: 'Professional', icon: '💼' },
  { value: 'casual', label: 'Casual', icon: '😊' },
  { value: 'enthusiastic', label: 'Enthusiastic', icon: '🎉' },
  { value: 'informal', label: 'Informal', icon: '🙂' },
  { value: 'neutral', label: 'Neutral', icon: 'ℹ️' },
  { value: 'funny', label: 'Funny', icon: '😄' },
];

export const FORMAT_OPTIONS: readonly AdjustOption<FormatOption>[] = [
  { value: 'paragraph', label: 'Paragraph', icon: '📝' },
  { value: 'email', label: 'Email', icon: '📧' },
  { value: 'ideas', label: 'Ideas', icon: '💡' },
  { value: 'blog', label: 'Blog post', icon: '📰' },
];

export const LENGTH_OPTIONS: readonly AdjustOption<LengthOption>[] = [
  { value: 'short', label: 'Short', icon: '📏' },
  { value: 'medium', label: 'Medium', icon: '📐' },
  { value: 'long', label: 'Long', icon: '📜' },
];

/* ── Default settings ── */

/**
 * Default settings values.
 *
 * Kept free of an import from the settings module to avoid a cycle; a test
 * asserts these parse cleanly against `settingsSchema` so the two cannot drift.
 */
export const DEFAULT_SETTINGS = {
  provider: 'openai',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.3,
  maxTokens: 2048,
  stream: true,
  theme: 'system',
  baseUrl: '',
  translateLanguage: 'English',
} as const;
