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

/**
 * A selection the extension can actually write back into.
 *
 * Edge only offers Rewrite in editable fields, and so do we: every card that
 * opens can be applied. Read-only page text used to open a card whose Replace
 * button silently degraded to a clipboard copy and relabelled itself "Copied
 * instead", which is a confusing thing to discover after the fact.
 */
export function getEditableSelectionInfo(): SelectionInfo | null {
  const info = getSelectionInfo();
  return info && isEditableSelection(info) ? info : null;
}

export function isEditableSelection(info: SelectionInfo): boolean {
  return (
    info.elementType === 'textarea' ||
    info.elementType === 'input' ||
    info.elementType === 'contenteditable'
  );
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
    selectionStart: start,
    selectionEnd: end,
  };
}

/** A selection in contenteditable or static page text. */
function readWindowSelection(): SelectionInfo | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0)
    return null;

  const text = selection.toString().trim();
  if (!text) return null;

  /**
   * A snapshot, not the selection's own range.
   *
   * `getRangeAt(0)` hands back the very object the selection holds — the same
   * reference on every call — so writing to it writes to the page's live
   * selection. `replace.ts` moves this range's boundaries while inserting, which
   * would otherwise reach back into the document. A clone still tracks DOM
   * mutation, which is what the detached-range check relies on.
   */
  const range = selection.getRangeAt(0).cloneRange();
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
    selectionStart: null,
    selectionEnd: null,
  };
}

/**
 * Place the card just below a rect, clamped inside the viewport.
 *
 * Flips above the anchor when there is not enough room below, so the action
 * buttons cannot end up under the fold where nothing can scroll them into view.
 *
 * `height` is the card's real height. Passing the worst-case drawer-open height
 * as if it were the actual height put the card up to 90px *above* the text it was
 * rewriting, covering it — and on a short viewport clamped every position to the
 * same constant, ignoring the selection entirely. Callers that have measured the
 * rendered card pass its height; the default is the closed-card estimate.
 */
export function positionBelow(
  rect: DOMRect,
  height: number = CARD.height,
): CardPosition {
  return positionAnchored(rect, {
    width: CARD.width,
    height,
    offset: CARD.offset,
  });
}

interface AnchorSize {
  readonly width: number;
  readonly height: number;
  readonly offset: number;
}

/** The shared geometry, used for both the card and the trigger button. */
export function positionAnchored(
  rect: DOMRect,
  size: AnchorSize,
): CardPosition {
  const { margin } = CARD;
  const { width, offset } = size;

  /**
   * Never claim more room than the viewport has.
   *
   * This clamp only keeps the surface on screen because the surface itself is
   * capped to the same height — `--card-max-height` in the shadow stylesheet,
   * consumed by `.card`. Without that cap a measured height larger than the
   * viewport was silently reduced here, and the card then overhung the bottom
   * edge by the difference, taking its action bar with it.
   */
  const height = Math.min(size.height, window.innerHeight - 2 * margin);

  const fitsBelow =
    rect.bottom + offset + height <= window.innerHeight - margin;
  const fitsAbove = rect.top - offset - height >= margin;

  const top = fitsBelow
    ? rect.bottom + offset
    : fitsAbove
      ? rect.top - offset - height
      : // Neither side fits: sit as low as possible without overflowing.
        window.innerHeight - height - margin;

  return {
    top: clamp(
      top,
      margin,
      Math.max(margin, window.innerHeight - height - margin),
    ),
    left: clamp(rect.left, margin, window.innerWidth - width - margin),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}
