import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard, replaceSelectedText } from '@/content/replace';
import type { SelectionInfo } from '@/shared/types';

function selectionFor(
  element: HTMLElement | null,
  elementType: SelectionInfo['elementType'],
  range: Range | null = null,
  offsets: { start: number; end: number } | null = null,
): SelectionInfo {
  return {
    text: 'old',
    range,
    element,
    elementType,
    position: { top: 0, left: 0 },
    selectionStart: offsets?.start ?? null,
    selectionEnd: offsets?.end ?? null,
  };
}

/**
 * jsdom does not implement execCommand. Tests that need the native-setter path
 * leave it returning false; tests for the undo-preserving path make it apply the
 * edit itself, the way a real browser would.
 *
 * Applying it for real matters now that the outcome is verified against the DOM:
 * a stub that returns true without editing anything is indistinguishable from an
 * editor that threw the edit away, which is exactly what it should be.
 */
function stubExecCommand(behaviour: 'unsupported' | 'insert'): void {
  document.execCommand = vi.fn(
    (command: string, _ui?: boolean, value?: string) => {
      if (behaviour === 'unsupported') return false;
      if (command !== 'insertText') return false;

      const field = document.activeElement as
        HTMLInputElement | HTMLTextAreaElement | null;
      if (field && 'value' in field) {
        const start = field.selectionStart ?? 0;
        const end = field.selectionEnd ?? 0;
        field.value =
          field.value.slice(0, start) + (value ?? '') + field.value.slice(end);
        return true;
      }

      // Contenteditable: insertText replaces the current selection.
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return false;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(value ?? ''));
      return true;
    },
  ) as typeof document.execCommand;
}

beforeEach(() => {
  document.body.innerHTML = '';
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn(() => Promise.resolve()) },
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('replaceSelectedText in a textarea', () => {
  it('replaces the selected range and reports it as replaced', async () => {
    stubExecCommand('unsupported');
    const textarea = document.createElement('textarea');
    textarea.value = 'keep old keep';
    document.body.appendChild(textarea);
    textarea.setSelectionRange(5, 8);

    const outcome = await replaceSelectedText(
      selectionFor(textarea, 'textarea'),
      'new',
    );

    expect(outcome).toBe('replaced');
    expect(textarea.value).toBe('keep new keep');
  });

  it('leaves the caret after the inserted text', async () => {
    stubExecCommand('unsupported');
    const textarea = document.createElement('textarea');
    textarea.value = 'ab';
    document.body.appendChild(textarea);
    textarea.setSelectionRange(0, 2);

    await replaceSelectedText(selectionFor(textarea, 'textarea'), 'xyz');

    expect(textarea.selectionStart).toBe(3);
    expect(textarea.selectionEnd).toBe(3);
  });

  it('dispatches input and change so frameworks observe the edit', async () => {
    stubExecCommand('unsupported');
    const textarea = document.createElement('textarea');
    textarea.value = 'old';
    document.body.appendChild(textarea);
    textarea.setSelectionRange(0, 3);

    const events: string[] = [];
    textarea.addEventListener('input', () => events.push('input'));
    textarea.addEventListener('change', () => events.push('change'));

    await replaceSelectedText(selectionFor(textarea, 'textarea'), 'new');

    expect(events).toEqual(['input', 'change']);
  });

  /** This path was unreachable dead code, so textarea edits were not undoable. */
  it('prefers execCommand so the browser undo stack is preserved', async () => {
    stubExecCommand('insert');
    const textarea = document.createElement('textarea');
    textarea.value = 'old';
    document.body.appendChild(textarea);
    textarea.setSelectionRange(0, 3);

    const outcome = await replaceSelectedText(
      selectionFor(textarea, 'textarea'),
      'new',
    );

    expect(outcome).toBe('replaced');
    expect(document.execCommand).toHaveBeenCalledWith(
      'insertText',
      false,
      'new',
    );
    expect(textarea.value).toBe('new');
  });
});

/**
 * The single most consequential regression. Every <input> replacement threw
 * `Illegal invocation` — the descriptor was always resolved from
 * HTMLTextAreaElement.prototype — and the catch reported success after falling
 * back to a clipboard copy, so the card showed a green "Replaced".
 */
describe('replaceSelectedText in an input', () => {
  // Only the types the HTML spec allows selection on; email and number are not
  // among them and are filtered out upstream in selection.ts.
  it.each(['text', 'search', 'url', 'tel', 'password'])(
    'replaces the selection in an input[type=%s]',
    async (type) => {
      stubExecCommand('unsupported');
      const input = document.createElement('input');
      input.type = type;
      input.value = 'keep old keep';
      document.body.appendChild(input);
      input.setSelectionRange(5, 8);

      const outcome = await replaceSelectedText(
        selectionFor(input, 'input'),
        'new',
      );

      expect(outcome).toBe('replaced');
      expect(input.value).toBe('keep new keep');
    },
  );

  it('does not write to the clipboard when the replacement succeeds', async () => {
    stubExecCommand('unsupported');
    const input = document.createElement('input');
    input.value = 'old';
    document.body.appendChild(input);
    input.setSelectionRange(0, 3);

    await replaceSelectedText(selectionFor(input, 'input'), 'new');

    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });
});

/**
 * Opening the card moves focus off the field, and a framework-controlled input
 * reacts to the blur by reassigning `value`, which collapses the selection to
 * the end. Re-reading the offsets at replace time therefore appended the rewrite
 * to the user's original text — while still reporting a successful replacement.
 */
describe('replaceSelectedText uses the offsets captured at selection time', () => {
  it('replaces the original range even after the field selection collapsed', async () => {
    stubExecCommand('unsupported');
    const textarea = document.createElement('textarea');
    textarea.value = 'keep old keep';
    document.body.appendChild(textarea);

    // What a controlled component does on blur: caret at the end, nothing selected.
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    const outcome = await replaceSelectedText(
      selectionFor(textarea, 'textarea', null, { start: 5, end: 8 }),
      'new',
    );

    expect(outcome).toBe('replaced');
    expect(textarea.value).toBe('keep new keep');
  });

  it('does not append when the live selection is collapsed at the end', async () => {
    stubExecCommand('unsupported');
    const textarea = document.createElement('textarea');
    textarea.value = 'original text';
    document.body.appendChild(textarea);
    textarea.setSelectionRange(13, 13);

    await replaceSelectedText(
      selectionFor(textarea, 'textarea', null, { start: 0, end: 13 }),
      'rewritten',
    );

    expect(textarea.value).toBe('rewritten');
    expect(textarea.value).not.toContain('original text');
  });

  it('refuses a stale range that no longer fits the field', async () => {
    stubExecCommand('unsupported');
    const textarea = document.createElement('textarea');
    textarea.value = 'short';
    document.body.appendChild(textarea);

    // The page replaced the content with something shorter since capture.
    const outcome = await replaceSelectedText(
      selectionFor(textarea, 'textarea', null, { start: 40, end: 60 }),
      'new',
    );

    expect(outcome).toBe('copied');
    expect(textarea.value).toBe('short');
  });
});

describe('replaceSelectedText in a contenteditable', () => {
  function buildEditable(text: string): { host: HTMLElement; range: Range } {
    const host = document.createElement('div');
    host.setAttribute('contenteditable', 'true');
    // jsdom does not derive isContentEditable from the attribute.
    Object.defineProperty(host, 'isContentEditable', {
      value: true,
      configurable: true,
    });
    host.textContent = text;
    document.body.appendChild(host);

    const range = document.createRange();
    range.selectNodeContents(host.firstChild!);
    return { host, range };
  }

  it('inserts via execCommand when available', async () => {
    stubExecCommand('insert');
    const { host, range } = buildEditable('old');

    const outcome = await replaceSelectedText(
      selectionFor(host, 'contenteditable', range),
      'new',
    );

    expect(outcome).toBe('replaced');
    expect(host.textContent).toBe('new');
    expect(document.execCommand).toHaveBeenCalledWith(
      'insertText',
      false,
      'new',
    );
  });

  it('falls back to manual DOM insertion when execCommand is unavailable', async () => {
    stubExecCommand('unsupported');
    const { host, range } = buildEditable('old');

    const outcome = await replaceSelectedText(
      selectionFor(host, 'contenteditable', range),
      'new',
    );

    expect(outcome).toBe('replaced');
    expect(host.textContent).toBe('new');
  });

  /**
   * The regression guard for a doubled insertion. `execCommand` fires a trusted
   * `input` of its own, so a synthetic one on top of it invites an editor that
   * applies `input` events to write the same text a second time.
   */
  it('does not add its own input event after execCommand', async () => {
    stubExecCommand('insert');
    const { host, range } = buildEditable('old');

    const inputEvents: InputEvent[] = [];
    host.addEventListener('input', (event) =>
      inputEvents.push(event as InputEvent),
    );

    await replaceSelectedText(
      selectionFor(host, 'contenteditable', range),
      'new',
    );

    expect(inputEvents).toHaveLength(0);
  });

  /**
   * The manual path writes the DOM itself, so nothing else will announce it —
   * but it announces the change without claiming to be an insertion, because an
   * editor that trusted `inputType: 'insertText'` would apply the text again.
   */
  it('announces the manual path without describing it as an insertion', async () => {
    stubExecCommand('unsupported');
    const { host, range } = buildEditable('old');

    const inputEvents: InputEvent[] = [];
    host.addEventListener('input', (event) =>
      inputEvents.push(event as InputEvent),
    );

    await replaceSelectedText(
      selectionFor(host, 'contenteditable', range),
      'new',
    );

    expect(inputEvents).toHaveLength(1);
    expect(inputEvents[0]!.inputType).toBe('');
    expect(inputEvents[0]!.data).toBeNull();
  });

  /**
   * The range is captured when the card opens, so the host page may have
   * re-rendered since. Mutating a detached subtree would report success for text
   * the user never sees.
   */
  it('copies instead when the captured range has been detached', async () => {
    stubExecCommand('insert');
    const { host, range } = buildEditable('old');
    host.remove();

    const outcome = await replaceSelectedText(
      selectionFor(host, 'contenteditable', range),
      'new',
    );

    expect(outcome).toBe('copied');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('new');
  });

  /**
   * Lexical, ProseMirror and Slate own their document and apply edits from
   * `beforeinput`. Offering it to them first is the only way in — and once they
   * have taken it, inserting as well would put the text in twice.
   */
  it('lets an editor that claims beforeinput apply the edit itself', async () => {
    stubExecCommand('insert');
    const { host, range } = buildEditable('old');
    host.addEventListener('beforeinput', (event) => {
      event.preventDefault();
      host.textContent = `${(event as InputEvent).data}`;
    });

    const outcome = await replaceSelectedText(
      selectionFor(host, 'contenteditable', range),
      'new',
    );

    expect(outcome).toBe('replaced');
    expect(host.textContent).toBe('new');
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  /**
   * The failure that reported itself as a success: an editor reconciles its own
   * document over the top and the rewrite is gone, while the card said
   * "Replaced".
   */
  it('reports copied when the editor throws the edit away', async () => {
    stubExecCommand('insert');
    const { host, range } = buildEditable('old');

    /**
     * Reverted from a MutationObserver, as Lexical does — asynchronously, and
     * without waiting to be told. That timing is why the outcome is verified a
     * frame and a task later rather than immediately: a synchronous check reports
     * success for an edit that is about to be undone.
     */
    const observer = new MutationObserver(() => {
      if (host.textContent !== 'old') host.textContent = 'old';
    });
    observer.observe(host, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    try {
      const outcome = await replaceSelectedText(
        selectionFor(host, 'contenteditable', range),
        'new',
      );

      expect(outcome).toBe('copied');
      expect(host.textContent).toBe('old');
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('new');
    } finally {
      observer.disconnect();
    }
  });

  /**
   * The reported symptom — "message 1. message 2".
   *
   * The page has been changed, so "Copied instead" would be a lie by omission:
   * it reads as "the field was left alone" while a doubled message sits in it.
   */
  it('says the field needs checking when the rewrite lands beside the original', async () => {
    stubExecCommand('insert');
    const { host, range } = buildEditable('old');
    host.addEventListener('beforeinput', (event) => {
      event.preventDefault();
      host.textContent = `old${(event as InputEvent).data}`;
    });

    const outcome = await replaceSelectedText(
      selectionFor(host, 'contenteditable', range),
      'new',
    );

    expect(outcome).toBe('copied-dirty');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('new');
  });

  /**
   * The false negative in the first attempt at this fix: a legitimate Expand
   * contains the original, and `!after.includes(before)` rejected every one of
   * them as a failure.
   */
  it('accepts a rewrite that legitimately contains the original', async () => {
    stubExecCommand('insert');
    const { host, range } = buildEditable('ship it');

    const outcome = await replaceSelectedText(
      { ...selectionFor(host, 'contenteditable', range), text: 'ship it' },
      'ship it today, without fail',
    );

    expect(outcome).toBe('replaced');
    expect(host.textContent).toBe('ship it today, without fail');
  });

  /** Whitespace alone is not a change worth writing into the page. */
  it('reports an unchanged rewrite without touching the page', async () => {
    stubExecCommand('insert');
    const { host, range } = buildEditable('already right');

    const outcome = await replaceSelectedText(
      {
        ...selectionFor(host, 'contenteditable', range),
        text: 'already right',
      },
      'already right\n',
    );

    expect(outcome).toBe('unchanged');
    expect(host.textContent).toBe('already right');
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  /**
   * Inserting into a caret is what puts the text beside the original, so a
   * selection that will not restore has to stop the whole attempt.
   */
  it('refuses to insert when the selection cannot be restored', async () => {
    stubExecCommand('insert');
    const { host, range } = buildEditable('old');
    range.collapse(true);

    const outcome = await replaceSelectedText(
      selectionFor(host, 'contenteditable', range),
      'new',
    );

    expect(outcome).toBe('copied');
    expect(host.textContent).toBe('old');
    expect(document.execCommand).not.toHaveBeenCalled();
  });
});

describe('replaceSelectedText on a non-editable selection', () => {
  it('copies to the clipboard and says so', async () => {
    const outcome = await replaceSelectedText(
      selectionFor(null, 'unknown'),
      'new',
    );

    expect(outcome).toBe('copied');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('new');
  });

  it('reports failure when even the clipboard is unavailable', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(() => Promise.reject(new Error('not focused'))),
      },
    });
    document.execCommand = vi.fn(() => false) as typeof document.execCommand;

    await expect(
      replaceSelectedText(selectionFor(null, 'unknown'), 'new'),
    ).resolves.toBe('failed');
  });
});

describe('copyToClipboard', () => {
  it('uses the async clipboard API when it works', async () => {
    await expect(copyToClipboard('text')).resolves.toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('text');
  });

  it('falls back to a hidden textarea when the API rejects', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(() => Promise.reject(new Error('denied'))),
      },
    });
    document.execCommand = vi.fn(() => true) as typeof document.execCommand;

    await expect(copyToClipboard('text')).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('leaves no scratch element behind', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(() => Promise.reject(new Error('denied'))),
      },
    });
    document.execCommand = vi.fn(() => true) as typeof document.execCommand;

    await copyToClipboard('text');

    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });
});
