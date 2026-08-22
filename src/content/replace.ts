/**
 * Writing rewritten text back into the page.
 *
 * Three strategies, tried in order of fidelity: the native value setter for
 * form fields, `execCommand('insertText')` for contenteditable, and a clipboard
 * copy when the selection is not editable at all.
 */

import type { SelectionInfo } from '@/shared/types';

/**
 * What actually happened.
 *
 * The old boolean return conflated "replaced" with "fell back to the clipboard",
 * so the card showed a green "Replaced" confirmation for text it had merely
 * copied — the single most misleading behaviour in the extension.
 *
 * `copied-dirty` is the honest report for the failure this file exists to prevent:
 * the page *was* changed, but not in the shape a substitution has. Plain "Copied
 * instead" would read as "nothing was written" while a doubled message sat in the
 * user's composer.
 */
export type ReplaceOutcome =
  'replaced' | 'unchanged' | 'copied' | 'copied-dirty' | 'failed';

/** How the contenteditable path finished, before the clipboard fallback. */
type ContentEditableOutcome = 'replaced' | 'dirty' | 'failed';

export async function replaceSelectedText(
  selectionInfo: SelectionInfo,
  newText: string,
): Promise<ReplaceOutcome> {
  const { element, elementType, range, text } = selectionInfo;
  let wasPageChanged = false;

  try {
    /**
     * Nothing to write. Checked whitespace-insensitively against the captured
     * selection — comparing raw strings let a single trailing newline through, and
     * then a rewrite identical to the original was inserted anyway.
     */
    if (squash(text) === squash(newText)) return 'unchanged';

    if ((elementType === 'textarea' || elementType === 'input') && element) {
      if (
        replaceInFormField(
          element as HTMLInputElement | HTMLTextAreaElement,
          newText,
          selectionInfo,
        )
      ) {
        return 'replaced';
      }
      return (await copyToClipboard(newText)) ? 'copied' : 'failed';
    }

    if (
      elementType === 'contenteditable' ||
      (range && isEditableRange(range))
    ) {
      if (range) {
        const outcome = await replaceInContentEditable(range, newText, text);
        if (outcome === 'replaced') return 'replaced';
        wasPageChanged = outcome === 'dirty';
      }
    }
  } catch (err) {
    console.warn('[Rewrite AI] Could not replace the selection:', err);
  }

  if (!(await copyToClipboard(newText))) return 'failed';
  return wasPageChanged ? 'copied-dirty' : 'copied';
}

/**
 * Replace the selected range inside an <input> or <textarea>.
 *
 * The native setter is used to bypass React's synthetic value tracking, which
 * otherwise ignores a direct `.value` assignment. Crucially the descriptor has
 * to come from the element's *own* prototype: the previous implementation always
 * resolved HTMLTextAreaElement's setter (its `||` fallback was unreachable,
 * since that descriptor always exists) and calling it on an <input> throws
 * `Illegal invocation` — so every single input replacement failed and silently
 * degraded to a clipboard copy.
 */
function replaceInFormField(
  field: HTMLInputElement | HTMLTextAreaElement,
  newText: string,
  selectionInfo: SelectionInfo,
): boolean {
  /**
   * Use the offsets captured when the selection was made, not the field's
   * current ones. Opening the card moves focus away, and a framework-controlled
   * field reacts to the blur by reassigning `value`, which collapses the
   * selection to the end — re-reading here appended the rewrite to the user's
   * original text while still reporting a successful replacement.
   */
  /**
   * A detached field still answers `.value` and `.setSelectionRange`, so every
   * check below passes and the native setter writes into an orphan node that is
   * no longer in the document — reported as `'replaced'`, with the rewrite lost
   * and not even on the clipboard. A framework that re-creates the node on blur
   * is all it takes.
   */
  if (!field.isConnected) return false;

  const start = selectionInfo.selectionStart ?? field.selectionStart ?? 0;
  const end = selectionInfo.selectionEnd ?? field.selectionEnd ?? 0;

  // The field may have changed under us; a stale range would corrupt the value.
  if (start > field.value.length || end > field.value.length || start > end) {
    return false;
  }

  field.focus();

  // Preferred path: keeps the browser's native undo stack intact.
  if (trySelectRangeAndInsert(field, start, end, newText)) {
    dispatchFieldEvents(field);
    return true;
  }

  const setter = nativeValueSetter(field);
  if (!setter) return false;

  const nextValue =
    field.value.slice(0, start) + newText + field.value.slice(end);
  setter.call(field, nextValue);
  moveCaretTo(field, start + newText.length);
  dispatchFieldEvents(field);
  return true;
}

/** Not every input type supports the selection APIs, so this may legitimately fail. */
function moveCaretTo(
  field: HTMLInputElement | HTMLTextAreaElement,
  offset: number,
): void {
  try {
    field.setSelectionRange(offset, offset);
  } catch {
    // The value was still replaced; only the caret position is unavailable.
  }
}

/**
 * Insert via execCommand so Ctrl+Z still works.
 *
 * This path was previously dead code, which is why replacements in a textarea
 * could not be undone.
 */
function trySelectRangeAndInsert(
  field: HTMLInputElement | HTMLTextAreaElement,
  start: number,
  end: number,
  newText: string,
): boolean {
  try {
    field.setSelectionRange(start, end);
    const inserted = document.execCommand('insertText', false, newText);
    // execCommand can report success without changing anything.
    return (
      inserted && field.value.slice(start, start + newText.length) === newText
    );
  } catch {
    return false;
  }
}

function nativeValueSetter(
  field: HTMLInputElement | HTMLTextAreaElement,
): ((value: string) => void) | undefined {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;

  return Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
}

/** Notify React / Vue / Angular that the field changed. */
function dispatchFieldEvents(
  field: HTMLInputElement | HTMLTextAreaElement,
): void {
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Replace a range inside a contenteditable host.
 *
 * Reproduced in a real Lexical editor (WhatsApp Web's composer): the rewrite
 * arrived *beside* the original — "message 1. message 2" — because a
 * script-constructed `InputEvent` carries no target ranges, and Lexical, Slate and
 * Quill all take the range to replace from `getTargetRanges()` rather than from
 * the DOM selection. With that array empty Lexical declined the event,
 * `execCommand` ran, and Lexical then re-applied the text at its own cached caret.
 *
 * Hence: restore the selection, let the editor observe it, offer the edit *with*
 * target ranges, and only then fall back to writing it ourselves.
 */
async function replaceInContentEditable(
  range: Range,
  newText: string,
  originalText: string,
): Promise<ContentEditableOutcome> {
  const host = getEditingHost(range.commonAncestorContainer);
  if (!host) return 'failed';

  const selection = window.getSelection();
  if (!selection) return 'failed';

  if (!(await restoreSelection(selection, range, host))) return 'failed';

  /**
   * Validated *after* the restore, not before it.
   *
   * `restoreSelection` awaits two or three tasks so the editor can observe the
   * selection, and the page is free to re-render during them. Checking first
   * meant the guard described below was answering a question about a DOM that no
   * longer existed by the time the edit landed: a re-render leaving the boundary
   * nodes attached but their text changed would pass, and the edit would destroy
   * something the user never selected. The `before` snapshot has the same
   * problem — taken early, it made `verifySubstitution`'s length arithmetic
   * compare against a baseline that was already gone.
   */
  if (
    !isRangeConnected(range) ||
    squash(range.toString()) !== squash(originalText)
  ) {
    return 'failed';
  }

  const before = host.textContent ?? '';

  /**
   * Strategies in order of fidelity, stopping at the first that takes.
   *
   * "Taken" means the editor cancelled the event *or* the host's text changed —
   * cancellation alone would misread an editor that claimed the edit and applied
   * it asynchronously, and inserting again after that is what doubles the text.
   */
  if (offerToEditor(host, range, newText)) {
    return verifySubstitution(host, before, originalText, newText);
  }

  if (document.execCommand('insertText', false, newText)) {
    // execCommand fires a trusted `input` of its own; a second, synthetic one
    // invites an editor to apply the same text twice.
    return verifySubstitution(host, before, originalText, newText);
  }

  if (!insertOverRange(selection, range, newText)) return 'failed';

  notifyInput(host);
  return verifySubstitution(host, before, originalText, newText);
}

/**
 * Put the selection back, let the editor see it, and confirm it held.
 *
 * The yield is a **task**, not a microtask: `selectionchange` is delivered by
 * queuing a task, so `await Promise.resolve()` would run before the editor heard
 * anything. It is deliberately not an animation frame either — ~16ms lands inside
 * the window where ProseMirror's focus handler overwrites the DOM selection with
 * its own, so the whole pre-insert delay stays in the low single digits.
 */
async function restoreSelection(
  selection: Selection,
  range: Range,
  host: HTMLElement,
): Promise<boolean> {
  // preventScroll: the page must not jump to the field the card is already
  // anchored to.
  host.focus({ preventScroll: true });
  await nextTask();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    selection.removeAllRanges();
    selection.addRange(range);
    await nextTask();

    if (selectionHolds(selection, range)) return true;
  }

  // Inserting into a caret is precisely how the rewrite ends up beside the
  // original, so a selection that will not hold is a hard stop, not a "try anyway".
  return false;
}

function selectionHolds(selection: Selection, range: Range): boolean {
  if (selection.rangeCount === 0 || selection.isCollapsed) return false;

  const live = selection.getRangeAt(0);
  return (
    live.compareBoundaryPoints(Range.START_TO_START, range) === 0 &&
    live.compareBoundaryPoints(Range.END_TO_END, range) === 0
  );
}

/**
 * Give a framework editor the chance to apply the edit through its own pipeline.
 *
 * The target ranges are the point. Lexical reads `event.getTargetRanges()` both to
 * decide it is replacing a non-collapsed selection and to repair a stale internal
 * selection from the DOM; without them it does neither. `execCommand('insertText')`
 * dispatches no `beforeinput` at all, so an edit made that way is invisible to
 * such an editor — it lands and is then reverted, or duplicated.
 *
 * Returns true when the editor took the edit on itself.
 */
function offerToEditor(
  host: HTMLElement,
  range: Range,
  newText: string,
): boolean {
  const before = host.textContent ?? '';

  let event: InputEvent;
  try {
    event = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: newText,
      // Not in the published InputEvent docs, but it is in Blink's IDL and is
      // honoured — verified in Chromium before this was built on.
      targetRanges: [staticRangeFor(range)],
    } as InputEventInit);
  } catch {
    // A StaticRange the browser will not accept; the fallbacks below still apply.
    return false;
  }

  const cancelled = !host.dispatchEvent(event);
  return cancelled || (host.textContent ?? '') !== before;
}

function staticRangeFor(range: Range): StaticRange {
  return new StaticRange({
    startContainer: range.startContainer,
    startOffset: range.startOffset,
    endContainer: range.endContainer,
    endOffset: range.endOffset,
  });
}

/** Manual surgery, for hosts where execCommand is blocked. */
function insertOverRange(
  selection: Selection,
  range: Range,
  newText: string,
): boolean {
  range.deleteContents();
  const textNode = document.createTextNode(newText);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.setEndAfter(textNode);
  selection.removeAllRanges();
  selection.addRange(range);

  return textNode.isConnected;
}

/**
 * Tell the page something changed.
 *
 * Deliberately carries no `inputType` or `data`: this fires only after we wrote
 * the DOM ourselves, and an editor that mistook it for a native insertion would
 * apply the same text a second time.
 */
function notifyInput(host: HTMLElement): void {
  host.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

/**
 * Did the text actually get *replaced*?
 *
 * Length arithmetic on whitespace-stripped text: a substitution removes what it
 * replaced, so the result is shorter by the old text and longer by the new. An
 * append fails that (it is `before + new`) while a legitimate Expand passes even
 * though its result contains the original — which the previous
 * `!after.includes(before)` test rejected outright.
 *
 * Whitespace is stripped rather than normalised because Lexical renders paragraph
 * breaks as elements, so `textContent` loses newlines a multi-paragraph rewrite
 * contains and any count on raw text would be spuriously wrong.
 *
 * Awaited a frame and a task first: Lexical commits in a microtask and reverts
 * foreign DOM from a MutationObserver, both after the call returns, so a
 * synchronous check reports success for an edit that is about to be undone.
 */
async function verifySubstitution(
  host: HTMLElement,
  before: string,
  originalText: string,
  newText: string,
): Promise<ContentEditableOutcome> {
  await nextFrame();
  await nextTask();

  const after = squash(host.textContent ?? '');
  const expected =
    squash(before).length -
    squash(originalText).length +
    squash(newText).length;

  if (after.length === expected && after.includes(squash(newText))) {
    return 'replaced';
  }

  // The page was changed but not in the shape a substitution has: the rewrite
  // went in beside the original, or the editor rewrote it into something else.
  // Saying "Copied instead" here would read as "nothing was written".
  return squash(before) === after ? 'failed' : 'dirty';
}

/** How long to wait for a frame that a background tab will never deliver. */
const HIDDEN_TAB_FRAME_TIMEOUT_MS = 50;

/** Whitespace-insensitive comparison, for text that crosses a DOM boundary. */
function squash(text: string): string {
  return text.replace(/\s+/g, '');
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A frame, or a short wait if frames are not coming.
 *
 * `requestAnimationFrame` is suspended in a background tab, so switching tabs in
 * the moment after Replace left the verification parked indefinitely — and with
 * it the card's re-entry guard, which is only released when this resolves.
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    requestAnimationFrame(done);
    setTimeout(done, HIDDEN_TAB_FRAME_TIMEOUT_MS);
  });
}

/** True when both of a range's boundary nodes are still in the document. */
function isRangeConnected(range: Range): boolean {
  return range.startContainer.isConnected && range.endContainer.isConnected;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyViaTextArea(text);
  }
}

/** Clipboard fallback for contexts where the async API is unavailable. */
function copyViaTextArea(text: string): boolean {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('aria-hidden', 'true');
  textArea.style.position = 'fixed';
  textArea.style.top = '0';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);

  try {
    textArea.focus();
    textArea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textArea.remove();
  }
}

/**
 * The editing host — the element that actually carries `contenteditable`.
 *
 * Not the nearest node reporting `isContentEditable`: *every* descendant of a
 * contenteditable reports true, so walking to the nearest one stops at the inner
 * `<span>` in Lexical's `<div contenteditable><p><span>` shape. Verified in
 * Chromium. That mattered twice over — the element we focused and, worse, the
 * element whose text was compared to decide whether the replacement worked, so an
 * append landing in a sibling node was invisible.
 */
function getEditingHost(node: Node): HTMLElement | null {
  const start: HTMLElement | null =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : node.parentElement;

  let host: HTMLElement | null = null;
  for (let el = start; el; el = el.parentElement) {
    if (!el.isContentEditable) break;
    // Keep climbing: the outermost editable element is the host.
    host = el;
  }
  return host;
}

function isEditableRange(range: Range): boolean {
  return getEditingHost(range.commonAncestorContainer) !== null;
}
