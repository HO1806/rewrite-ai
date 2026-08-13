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
 */
export type ReplaceOutcome = 'replaced' | 'copied' | 'failed';

export async function replaceSelectedText(
  selectionInfo: SelectionInfo,
  newText: string,
): Promise<ReplaceOutcome> {
  const { element, elementType, range } = selectionInfo;

  try {
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
      if (range && replaceInContentEditable(range, newText)) {
        return 'replaced';
      }
    }
  } catch (err) {
    console.warn('[Rewrite AI] Could not replace the selection:', err);
  }

  return (await copyToClipboard(newText)) ? 'copied' : 'failed';
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
 * The range was captured when the card opened, so it may since have been
 * detached by the host page re-rendering. `isRangeConnected` checks that before
 * touching the DOM, rather than mutating an orphaned subtree and reporting
 * success for text the user will never see.
 */
function replaceInContentEditable(range: Range, newText: string): boolean {
  if (!isRangeConnected(range)) return false;

  const selection = window.getSelection();
  if (!selection) return false;

  const editableEl = getEditableAncestor(range.commonAncestorContainer);
  if (!editableEl) return false;

  editableEl.focus();
  selection.removeAllRanges();
  selection.addRange(range);

  if (!document.execCommand('insertText', false, newText)) {
    // Manual fallback for hosts where execCommand is blocked.
    range.deleteContents();
    const textNode = document.createTextNode(newText);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    selection.removeAllRanges();
    selection.addRange(range);

    if (!textNode.isConnected) return false;
  }

  editableEl.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      cancelable: false,
      inputType: 'insertText',
      data: newText,
    }),
  );

  return true;
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

function getEditableAncestor(node: Node): HTMLElement | null {
  let el: HTMLElement | null =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : node.parentElement;

  while (el) {
    if (el.isContentEditable) return el;
    el = el.parentElement;
  }
  return null;
}

function isEditableRange(range: Range): boolean {
  return getEditableAncestor(range.commonAncestorContainer) !== null;
}
