/**
 * Shared type definitions used across the extension.
 */

/**
 * The two things this extension does.
 *
 * It offered seven, six of which were only ever reachable from a right-click
 * menu that has now been removed — the keyboard shortcut is the sole entry
 * point. Fix Grammar is not missing but merged: `improve` corrects when
 * correcting is all the text needs, and rewrites when it needs more.
 */
export type RewriteAction = 'improve' | 'translate';

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
  /**
   * Carries no text: the content script reads the live selection itself. The
   * variant that carried `selectionText` existed for the context menu, which has
   * been removed, and its text was ignored anyway — without a live, measurable
   * selection there is nothing to write a result back into.
   */
  | {
      type: 'TRIGGER_REWRITE';
      action: RewriteAction;
      /**
       * The stored translation language, sent along rather than looked up.
       *
       * The worker already loads settings here to decide the action, and the
       * content script must not read that object itself — it holds the API key,
       * and it runs in a process shared with the page.
       */
      language: string;
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
 * Messages sent through the streaming port (content → background).
 */
export interface StreamRequest {
  type: 'START_REWRITE';
  action: RewriteAction;
  text: string;
}
