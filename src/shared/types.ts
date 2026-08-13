/**
 * Shared type definitions used across the extension.
 */

/** All available rewrite actions */
export type RewriteAction =
  | 'improve'
  | 'grammar'
  | 'professional'
  | 'friendly'
  | 'concise'
  | 'expand'
  | 'translate';

/** Supported AI providers */
export type ProviderType =
  | 'openai'
  | 'groq'
  | 'gemini'
  | 'openrouter'
  | 'anthropic'
  | 'ollama'
  | 'custom';

/** Theme options */
export type ThemeOption = 'light' | 'dark' | 'system';

/** Position coordinates for the floating card */
export interface CardPosition {
  top: number;
  left: number;
}

/** Information about the active text selection */
export interface SelectionInfo {
  text: string;
  range: Range | null;
  element: Element | null;
  elementType: 'textarea' | 'input' | 'contenteditable' | 'unknown';
  position: CardPosition;
}

/**
 * Messages sent from background → content script.
 */
export type BackgroundToContentMessage =
  | {
      type: 'REWRITE_REQUEST';
      action: RewriteAction;
      text: string;
    }
  | {
      type: 'TRIGGER_REWRITE';
      action: RewriteAction;
    };

/**
 * Messages sent through the streaming port (background → content).
 */
export type StreamMessage =
  | { type: 'CHUNK'; text: string }
  | { type: 'DONE'; fullText: string }
  | { type: 'ERROR'; message: string };

export type ToneOption =
  'professional' | 'casual' | 'enthusiastic' | 'informal' | 'neutral' | 'funny';
export type FormatOption = 'paragraph' | 'email' | 'ideas' | 'blog';
export type LengthOption = 'short' | 'medium' | 'long';

export interface AdjustParams {
  tone?: ToneOption;
  format?: FormatOption;
  length?: LengthOption;
}

/**
 * Messages sent through the streaming port (content → background).
 */
export interface StreamRequest {
  type: 'START_REWRITE';
  action: RewriteAction;
  text: string;
  adjustParams?: AdjustParams;
}
