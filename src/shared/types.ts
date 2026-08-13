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
  /**
   * Offsets captured at selection time, for form fields.
   *
   * These must be recorded up front and not re-read when replacing. Opening the
   * card moves focus off the field, and a framework-controlled input reacts to
   * the blur by reassigning `value`, which collapses the selection — so a
   * re-read yields `start === end === value.length` and the rewrite gets
   * appended instead of replacing anything.
   */
  selectionStart: number | null;
  selectionEnd: number | null;
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
    }
  /** Readiness probe; the content script answers immediately. */
  | { type: 'PING' };

/**
 * Messages sent through the streaming port (background → content).
 */
export type StreamMessage =
  | { type: 'CHUNK'; text: string }
  | { type: 'DONE'; fullText: string }
  | { type: 'ERROR'; message: string };

/**
 * Edge's five tones, verbatim.
 *
 * An earlier pass replaced `informational` with an invented `informal` +
 * `neutral` pair while fixing a mislabelled pill. Edge offers exactly these
 * five, and matching it is the point.
 */
export type ToneOption =
  'professional' | 'casual' | 'enthusiastic' | 'informational' | 'funny';
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
