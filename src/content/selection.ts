/**
 * Reading the active selection and deciding where to put the card.
 *
 * All coordinates here are **viewport** coordinates, because the card is
 * `position: fixed`. Adding `window.scrollY` — as the form-field path used to —
 * pushes the card off-screen by the scroll distance, so on a page scrolled a
 * couple of thousand pixels down the extension appeared to do nothing at all.
 */

import { CARD } from '@/shared/constants';
import type { CardPosition, SelectionInfo } from '@/shared/types';

/**
 * Input types that support the selection APIs.
 *
 * Per the HTML specification `selectionStart` and `setSelectionRange` apply only
 * to these types. `email` and `number` are excluded — they were previously in
 * this list, and reading a selection from them throws InvalidStateError.
 */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'password']);

export function getSelectionInfo(): SelectionInfo | null {
  const formFieldSelection = readFormFieldSelection();
  if (formFieldSelection) return formFieldSelection;

  return readWindowSelection();
}

/** A selection inside an <input> or <textarea>. */
function readFormFieldSelection(): SelectionInfo | null {
  const activeEl = document.activeElement;
  if (!activeEl) return null;

  const isTextArea = activeEl.tagName === 'TEXTAREA';
  const isTextInput =
    activeEl.tagName === 'INPUT' &&
    TEXT_INPUT_TYPES.has((activeEl as HTMLInputElement).type.toLowerCase());

  if (!isTextArea && !isTextInput) return null;

  const field = activeEl as HTMLInputElement | HTMLTextAreaElement;
  const start = field.selectionStart ?? 0;
  const end = field.selectionEnd ?? 0;
  if (start === end) return null;

  return {
    text: field.value.substring(start, end),
    range: null,
    element: field,
    elementType: isTextArea ? 'textarea' : 'input',
    position: positionBelow(field.getBoundingClientRect()),
  };
}

/** A selection in contenteditable or static page text. */
function readWindowSelection(): SelectionInfo | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0)
    return null;

  const text = selection.toString().trim();
  if (!text) return null;

  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const element =
    container.nodeType === Node.ELEMENT_NODE
      ? (container as Element)
      : container.parentElement;

  const isContentEditable =
    (element as HTMLElement | null)?.isContentEditable === true ||
    element?.closest('[contenteditable="true"]') != null;

  return {
    text,
    range,
    element,
    elementType: isContentEditable ? 'contenteditable' : 'unknown',
    position: positionBelow(range.getBoundingClientRect()),
  };
}

/**
 * Place the card just below a rect, clamped inside the viewport.
 *
 * Flips above the anchor when there is not enough room below, so the action
 * buttons cannot end up under the fold where nothing can scroll them into view.
 */
export function positionBelow(rect: DOMRect): CardPosition {
  const { width, maxHeight, offset, margin } = CARD;

  const spaceBelow = window.innerHeight - rect.bottom - offset;
  const top =
    spaceBelow >= maxHeight || rect.top < maxHeight
      ? Math.min(rect.bottom + offset, window.innerHeight - maxHeight - margin)
      : rect.top - maxHeight - offset;

  return {
    top: Math.max(margin, top),
    left: clamp(rect.left, margin, window.innerWidth - width - margin),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}
