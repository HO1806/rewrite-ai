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
/**
 * What the user selected, and how to write back into it.
 *
 * A discriminated union because the fields are correlated and were previously
 * only correlated by convention: a flat shape with `range`, `element`,
 * `selectionStart` and `selectionEnd` all nullable admits fifteen combinations
 * of which three are real, and `replace.ts` recovered the correlation with a
 * cast — narrowing by trust rather than by proof.
 */
export type SelectionInfo =
  FieldSelection | RichTextSelection | StaticSelection;

/**
 * A selection that can actually be written back into.
 *
 * The card and `replaceSelectedText` take this, not `SelectionInfo`, so
 * "is this editable?" is answered once — in `getEditableSelectionInfo` — and
 * every consumer downstream has the answer in the type.
 */
export type EditableSelection = FieldSelection | RichTextSelection;

interface SelectionBase {
  readonly text: string;
  /** Viewport coordinates: the card is `position: fixed`. */
  readonly position: CardPosition;
}

/** Inside an `<input>` or `<textarea>`, addressed by offset. */
export interface FieldSelection extends SelectionBase {
  readonly kind: 'field';
  readonly element: HTMLInputElement | HTMLTextAreaElement;
  /**
   * Offsets captured at selection time, and deliberately not re-read later.
   *
   * Opening the card moves focus off the field, and a framework-controlled
   * input reacts to the blur by reassigning `value`, which collapses the
   * selection — so a re-read yields `start === end === value.length` and the
   * rewrite gets appended instead of replacing anything.
   */
  readonly start: number;
  readonly end: number;
}

/**
 * Inside a `contenteditable`, addressed by range.
 *
 * Carries no element. The one it used to carry was the range's common ancestor
 * — the *inner* node of an editor's tree, not the editing host, which is the
 * distinction that makes an append invisible to a text comparison. `replace.ts`
 * derives the host from the range with the right rule instead, and nothing read
 * the stored element.
 */
export interface RichTextSelection extends SelectionBase {
  readonly kind: 'rich';
  readonly range: Range;
}

/** Ordinary page text: measurable, quotable, not writable. */
export interface StaticSelection extends SelectionBase {
  readonly kind: 'static';
  readonly range: Range;
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
 * One-shot messages between the extension's own surfaces.
 *
 * Declared here so `messages.ts` can `satisfies z.ZodType<...>` against them,
 * the same drift guard the port messages already had. Without a type to check
 * against, a typo in one of these string literals compiled cleanly at the send
 * site and failed silently at the receiver, which validates and drops.
 */
export interface GetThemeRequest {
  type: 'GET_THEME';
}

export interface SetLanguageRequest {
  type: 'SET_LANGUAGE';
  language: string;
}

/**
 * Messages sent through the streaming port (background → content).
 */
export type StreamMessage =
  | { type: 'CHUNK'; text: string }
  | {
      type: 'DONE';
      fullText: string;
      /** The model ran out of room; the text is real but stops early. */
      truncated?: boolean;
    }
  | { type: 'ERROR'; message: string };

/**
 * Messages sent through the streaming port (content → background).
 */
export interface StreamRequest {
  type: 'START_REWRITE';
  action: RewriteAction;
  text: string;
}
