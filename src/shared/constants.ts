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

/** Shadow DOM host element ID for the floating card */
export const SHADOW_HOST_ID = 'rewrite-ai-root';

/** Shadow DOM host element ID for the inline trigger button */
export const TRIGGER_HOST_ID = 'rewrite-ai-trigger';

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

/**
 * How long a streamed generation may run before it is aborted.
 *
 * Safe to exceed the service worker's idle timeout because each relayed chunk is
 * extension-API activity, which resets it.
 */
export const REQUEST_TIMEOUT_MS = 90_000;

/**
 * The same ceiling when streaming is off.
 *
 * With no streaming there is a single `await fetch` and no API activity in
 * between, so nothing resets the worker's ~30s idle timer — a longer timeout can
 * never fire, because the worker is evicted first and the client just sees the
 * port close. Kept under that budget so the timeout is the thing that wins.
 */
export const REQUEST_TIMEOUT_NO_STREAM_MS = 25_000;

/* ── Floating card geometry ── */

/**
 * Card dimensions, in CSS pixels.
 *
 * These were three disagreeing literals (a 460px card clamped against 470 in
 * one code path and 380 in another), which let the card overhang the viewport.
 */
export const CARD = {
  width: 460,
  /**
   * Estimated height with the adjust drawer closed, used to place the card
   * before it has been measured. Treating the worst-case height as the actual
   * height put the card above the text it was rewriting.
   */
  height: 220,
  /** Gap between the selection and the card. */
  offset: 8,
  /** Minimum distance from any viewport edge. */
  margin: 10,
} as const;

/** Inline trigger button geometry, for the same edge clamping. */
export const TRIGGER = {
  width: 150,
  height: 32,
  offset: 6,
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

/**
 * Providers, and a starting set of models for each.
 *
 * **A model id is a dated assertion, not a constant.** Every list here was
 * accurate once and went stale: Groq retired both of its entries two months after
 * announcing them, and an id that no longer exists becomes a 404 the moment a user
 * switches provider, because `models[0]` is also the default. The provider itself
 * is the source of truth — the options page can ask it what this key may actually
 * use — and these are the offline fallback and the first-run default.
 *
 * Preview-tier models are deliberately excluded: they are documented as removable
 * at short notice, which is the failure this list exists to survive.
 *
 * Verified against each provider's live catalogue on 14 August 2026.
 */
export const PROVIDERS: readonly ProviderDescriptor[] = [
  {
    value: 'openai',
    label: 'OpenAI',
    needsApiKey: true,
    needsBaseUrl: false,
    models: ['gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6-sol'],
    apiKeyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    value: 'groq',
    label: 'Groq (ultra fast)',
    needsApiKey: true,
    needsBaseUrl: false,
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    apiKeyUrl: 'https://console.groq.com/keys',
  },
  {
    value: 'gemini',
    label: 'Google Gemini',
    needsApiKey: true,
    needsBaseUrl: false,
    models: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'],
    apiKeyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    value: 'anthropic',
    label: 'Anthropic Claude',
    needsApiKey: true,
    needsBaseUrl: false,
    models: ['claude-sonnet-5', 'claude-haiku-4-5-20251001'],
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    value: 'openrouter',
    label: 'OpenRouter',
    needsApiKey: true,
    needsBaseUrl: false,
    models: ['openai/gpt-oss-120b', 'anthropic/claude-haiku-4.5'],
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
    models: ['openai/gpt-oss-20b'],
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

/**
 * An adjust option.
 *
 * Text only, no icon: Edge's options are plain labels, and the sixteen emoji
 * this used to carry were the most conspicuously non-native detail in the card.
 */
export interface AdjustOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

/**
 * The three option sets below are Edge's, verbatim and in its order. Labels must
 * describe what the prompt actually asks for — one of these once read "Funny"
 * while sending a value that instructed the model to be neutral and objective.
 */
export const TONE_OPTIONS: readonly AdjustOption<ToneOption>[] = [
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'enthusiastic', label: 'Enthusiastic' },
  { value: 'informational', label: 'Informational' },
  { value: 'funny', label: 'Funny' },
];

export const FORMAT_OPTIONS: readonly AdjustOption<FormatOption>[] = [
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'email', label: 'Email' },
  { value: 'ideas', label: 'Ideas' },
  { value: 'blog', label: 'Blog post' },
];

export const LENGTH_OPTIONS: readonly AdjustOption<LengthOption>[] = [
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'long', label: 'Long' },
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
  model: 'gpt-5.6-terra',
  temperature: 0.3,
  maxTokens: 2048,
  stream: true,
  theme: 'system',
  baseUrl: '',
  translateLanguage: 'English',
} as const;
