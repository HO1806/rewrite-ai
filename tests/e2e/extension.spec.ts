/**
 * Browser smoke test for the built extension.
 *
 * Every assertion here exists because the equivalent unit test could not fail.
 * jsdom has no layout and no paint, so a card rendering behind the page and a
 * content script that was not listening yet both passed the whole unit suite
 * while the extension was completely unusable in Chrome.
 */

import {
  EXPECTED_REWRITE,
  LEXICAL_ORIGINAL,
  LONG_INPUT,
  LONG_REWRITE_FRAGMENT,
  expect,
  test,
} from './fixtures';
import type { Page } from '@playwright/test';

type Worker = import('@playwright/test').Worker;

/**
 * Poll PING until the content script answers.
 *
 * This is the same sequence `background/tabs.ts` runs, executed against a real
 * browser with real timings. It is the mechanism that makes delivery reliable:
 * a freshly navigated page has not finished importing the content script's
 * module graph, so sending straight away loses the race.
 */
async function waitForContentScript(worker: Worker): Promise<number> {
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (!tab?.id) throw new Error('no active tab');

    for (const delay of [0, 25, 50, 100, 150, 250, 400, 500]) {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
        return tab.id;
      } catch {
        // Not listening yet.
      }
    }
    throw new Error('content script never answered PING');
  });
}

/**
 * Fire the shortcut, which is the extension's only entry point.
 *
 * The message carries no text: the content script reads the live selection
 * itself, and a card that cannot write its result back is worse than no card.
 */
async function triggerRewrite(
  worker: Worker,
): Promise<{ ok: boolean; error?: string }> {
  const tabId = await waitForContentScript(worker);

  return worker.evaluate(async (id) => {
    try {
      /**
       * Reads the stored action and language exactly as the command handler
       * does. Hardcoding `improve` here made this helper unable to observe the
       * remembered tab at all — the behaviour it is used to test.
       */
      const stored = await chrome.storage.local.get('rewrite-ai-settings');
      const settings = (stored['rewrite-ai-settings'] ?? {}) as {
        lastAction?: string;
        translateLanguage?: string;
      };

      await chrome.tabs.sendMessage(id, {
        type: 'TRIGGER_REWRITE',
        action: settings.lastAction ?? 'improve',
        language: settings.translateLanguage ?? 'English',
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }, tabId);
}

/** The card lives in a shadow root; Playwright pierces it automatically. */
function card(page: Page) {
  return page.locator('#rewrite-ai-root .card');
}

/**
 * Select the whole of an editable field.
 *
 * Every rewrite now needs a live selection the extension can write back into —
 * matching Edge, which offers the feature only in editable fields.
 */
async function selectAllIn(page: Page, id: string): Promise<void> {
  await page.locator(`#${id}`).focus();
  await page.evaluate((target) => {
    const el = document.getElementById(target) as
      HTMLInputElement | HTMLTextAreaElement;
    el.setSelectionRange(0, el.value.length);
    document.dispatchEvent(new Event('selectionchange'));
  }, id);
}

/**
 * Select the whole of a contenteditable.
 *
 * A form field exposes offsets; a rich editor only has a Range, which is the
 * fragile half of the replacement path — it has to survive the card taking focus.
 */
/**
 * Ctrl+Z after a replacement must bring the user's original text back.
 *
 * `execCommand('insertText')` is preferred over a raw value assignment
 * specifically to keep the browser's native undo stack intact, and the
 * `beforeinput` path hands the edit to the editor's own history — but until
 * these assertions existed, nobody had ever pressed the key. Recovering from a
 * rewrite you did not want is the whole reason that matters.
 *
 * Focus is restored directly rather than by clicking: the card takes focus when
 * it opens and undo goes to whatever holds it, but the host fixture also carries
 * a high z-index overlay for the stacking test, which swallows real clicks.
 */
async function expectUndoRestores(
  page: Page,
  id: string,
  original: string,
): Promise<void> {
  await page.locator(`#${id}`).focus();
  await page.keyboard.press('ControlOrMeta+z');

  await expect
    .poll(() =>
      page.evaluate((target) => {
        const el = document.getElementById(target)!;
        return 'value' in el ? (el as HTMLInputElement).value : el.textContent;
      }, id),
    )
    .toBe(original);
}

async function selectAllInEditable(page: Page, id: string): Promise<void> {
  await page.evaluate((target) => {
    const el = document.getElementById(target)!;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, id);
}

/**
 * Measure the card against the viewport, from inside the page.
 *
 * Runs in the browser, so it cannot close over anything from the test file.
 */
function measureCard() {
  const host = document.getElementById('rewrite-ai-root')!;
  const root = host.shadowRoot!;
  const card = root.querySelector('.card')!;
  const actions = root.querySelector('.card__actions')!;
  const cardBox = card.getBoundingClientRect();
  const actionBox = actions.getBoundingClientRect();
  const hit = document.elementFromPoint(
    actionBox.left + actionBox.width / 2,
    actionBox.top + actionBox.height / 2,
  );

  return {
    viewportHeight: window.innerHeight,
    overhang: Math.max(
      cardBox.bottom - window.innerHeight,
      actionBox.bottom - window.innerHeight,
    ),
    cardBottom: cardBox.bottom,
    actionBottom: actionBox.bottom,
    topmostAtActions: hit?.id ?? hit?.tagName ?? null,
    maxHeight: getComputedStyle(card).maxHeight,
    outputHeight: root.querySelector('.card__output')!.getBoundingClientRect()
      .height,
  };
}

/** Put text in a field so the rewrite runs against it. */
async function setValue(page: Page, id: string, value: string): Promise<void> {
  await page.evaluate(
    ([target, next]) => {
      const el = document.getElementById(target!) as HTMLTextAreaElement;
      el.value = next!;
    },
    [id, value] as const,
  );
}

test.describe('extension loads', () => {
  test('registers a service worker with an extension id', async ({
    worker,
    extensionId,
  }) => {
    expect(extensionId).toMatch(/^[a-p]{32}$/);
    expect(worker.url()).toContain('service-worker-loader.js');
  });

  /** The permission went with the menu; asking for what you do not use is noise. */
  test('does not request the context-menu permission', async ({ worker }) => {
    const permissions = await worker.evaluate(
      () => chrome.runtime.getManifest().permissions ?? [],
    );

    expect(permissions).not.toContain('contextMenus');
    expect(permissions).toContain('storage');
  });

  test('renders the popup with its stylesheet applied', async ({
    context,
    extensionId,
  }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

    // One panel now; the Setup/Playground/Info tablist is gone.
    await expect(popup.getByLabel('Model')).toBeVisible();
    // A token-derived background proves the stylesheet loaded, not just the JS.
    const background = await popup.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(background).toContain('oklch');

    // The shortcut row must actually be a flex row; it previously used a class
    // that only exists inside the content script's shadow stylesheet.
    const display = await popup.evaluate(
      () => getComputedStyle(document.querySelector('.row')!).display,
    );
    expect(display).toBe('flex');
  });

  test('renders the options page', async ({ context, extensionId }) => {
    const options = await context.newPage();
    await options.goto(
      `chrome-extension://${extensionId}/src/options/index.html`,
    );

    await expect(
      options.getByRole('button', { name: /Save settings/ }),
    ).toBeVisible();
    // The response limit, creativity and streaming controls were removed while
    // keeping their values; the model picker is what the page is for now.
    await expect(options.getByLabel('Model')).toBeVisible();
  });
});

test.describe('the floating card', () => {
  test.beforeEach(async ({ seedSettings }) => {
    await seedSettings();
  });

  /**
   * The blocker. Without a z-index on the shadow host the card paints behind
   * every positioned page element, so it mounts, streams and bills — invisibly.
   */
  test('is visible and clickable above a high z-index page overlay', async ({
    context,
    worker,
    pageUrl,
  }) => {
    const page = await context.newPage();
    await page.goto(pageUrl);
    await selectAllIn(page, 'ta');

    expect(await triggerRewrite(worker)).toEqual({ ok: true });

    await expect(card(page)).toBeVisible();

    // The host must create a stacking context, or nothing below matters.
    const hostZIndex = await page.evaluate(
      () =>
        getComputedStyle(document.getElementById('rewrite-ai-root')!).zIndex,
    );
    expect(hostZIndex).toBe('2147483647');

    // The real assertion: the card, not the page's overlay, is what the user
    // would actually click at the card's centre.
    const topmost = await page.evaluate(() => {
      const host = document.getElementById('rewrite-ai-root')!;
      const el = host.shadowRoot!.querySelector('.card')!;
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
      return hit?.id ?? hit?.tagName ?? null;
    });
    expect(topmost).toBe('rewrite-ai-root');
  });

  test('streams the rewrite from the provider into the card', async ({
    context,
    worker,
    pageUrl,
  }) => {
    const page = await context.newPage();
    await page.goto(pageUrl);
    await selectAllIn(page, 'ta');

    await triggerRewrite(worker);

    await expect(card(page)).toContainText(EXPECTED_REWRITE);
    await expect(page.getByRole('button', { name: /^Replace$/ })).toBeEnabled();
  });

  /**
   * A long suggestion must not push the buttons off the bottom of the screen.
   *
   * The card is `position: fixed`, so an overhanging action bar cannot be
   * scrolled into view by anything — it is simply gone. The card grows from its
   * ~220px estimate to ~400px as text streams in, and `positionAnchored` clamps
   * against a height capped to the viewport, so it never notices the overflow.
   * Edge pins its buttons and scrolls the suggestion; so do we.
   */
  test('keeps the action bar on screen for a long suggestion in a short window', async ({
    context,
    worker,
    pageUrl,
  }) => {
    const page = await context.newPage();
    // Short enough that the grown card cannot fit — a laptop window, or any
    // window at 150% zoom.
    await page.setViewportSize({ width: 1280, height: 380 });
    await page.goto(pageUrl);

    // The provider stub keys its length off the input, and the content script
    // rewrites the live selection rather than the text in the message.
    await setValue(page, 'ta', LONG_INPUT);
    await selectAllIn(page, 'ta');
    await triggerRewrite(worker);

    await expect(card(page)).toContainText(LONG_REWRITE_FRAGMENT);

    // Polled, not read once: the card is capped by CSS as it grows and then
    // re-anchored on the next frame, so a single-shot read can catch the old
    // top with the new height.
    await expect
      .poll(() => page.evaluate(measureCard).then((m) => m.overhang))
      .toBeLessThanOrEqual(0);

    const geometry = await page.evaluate(measureCard);
    // Visible is not enough — the buttons must be what a click would land on.
    expect(geometry.topmostAtActions).toBe('rewrite-ai-root');
    await expect(page.getByRole('button', { name: /^Replace$/ })).toBeEnabled();

    // The cap has to resolve to a real length. `--card-max-height` comes from
    // CARD.margin via the shadow stylesheet, and an undefined custom property
    // makes the whole declaration invalid — silently restoring the bug.
    expect(geometry.maxHeight).toMatch(/^\d+(\.\d+)?px$/);
    // The suggestion area is what gave way, and it is still readable.
    expect(geometry.outputHeight).toBeGreaterThan(100);

    // The language picker is the one thing that still grows the card after it
    // has streamed, now that the adjust drawer is gone.
    await page.getByRole('tab', { name: 'Translate' }).click();
    await page.getByRole('button', { name: /Language:/ }).click();
    await expect
      .poll(() => page.evaluate(measureCard).then((m) => m.overhang))
      .toBeLessThanOrEqual(0);
    await expect(page.getByRole('button', { name: /^Replace$/ })).toBeVisible();
  });

  test('is dismissed by Escape', async ({ context, worker, pageUrl }) => {
    const page = await context.newPage();
    await page.goto(pageUrl);
    await selectAllIn(page, 'ta');
    await triggerRewrite(worker);
    await expect(card(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(card(page)).toHaveCount(0);
  });
});

/**
 * Edge's defining interaction: the offer appears on selecting text, with no
 * right-click. Only a real browser can confirm it is visible and clickable
 * against a hostile page.
 */
/**
 * The card's two modes, and the only route to Translate now that the right-click
 * menu is gone.
 */
test.describe('the mode tabs', () => {
  test.beforeEach(async ({ seedSettings }) => {
    await seedSettings();
  });

  test('switch between Rewrite and Translate, with a language gear', async ({
    context,
    worker,
    pageUrl,
  }) => {
    const page = await context.newPage();
    await page.goto(pageUrl);
    await selectAllIn(page, 'ta');
    await triggerRewrite(worker);

    await expect(card(page)).toContainText(EXPECTED_REWRITE);
    await expect(page.getByRole('tab', { name: 'Rewrite' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // The gear is Translate's; on Rewrite it would be a control that does nothing.
    await expect(page.getByRole('button', { name: /Language:/ })).toHaveCount(
      0,
    );

    await page.getByRole('tab', { name: 'Translate' }).click();

    await expect(page.getByRole('tab', { name: 'Translate' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(
      page.getByRole('button', { name: /Language: English/ }),
    ).toBeVisible();

    await page.getByRole('button', { name: /Language: English/ }).click();
    await expect(page.getByLabel(/Translate into/)).toBeVisible();
  });

  /**
   * The shortcut reopens the tab last used — the reason `lastAction` is persisted
   * rather than defaulting to Rewrite every time.
   */
  test('reopen on the tab last used', async ({ context, worker, pageUrl }) => {
    const page = await context.newPage();
    await page.goto(pageUrl);
    await selectAllIn(page, 'ta');
    await triggerRewrite(worker);

    await expect(card(page)).toContainText(EXPECTED_REWRITE);
    await page.getByRole('tab', { name: 'Translate' }).click();
    await page.keyboard.press('Escape');
    await expect(card(page)).toHaveCount(0);

    await selectAllIn(page, 'ta');
    await triggerRewrite(worker);

    await expect(page.getByRole('tab', { name: 'Translate' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});

/**
 * Keyboard and focus, in a real browser.
 *
 * The extension's only entry point is a keyboard shortcut, so these are not
 * accessibility niceties — they are whether the product works for someone not
 * using a mouse. Asserted here rather than in jsdom because focus, like layout,
 * is something jsdom only pretends to have.
 */
test.describe('keyboard operation', () => {
  test.beforeEach(async ({ seedSettings }) => {
    await seedSettings();
  });

  test('reaches and switches both tabs with the arrow keys', async ({
    context,
    worker,
    pageUrl,
  }) => {
    const page = await context.newPage();
    await page.goto(pageUrl);
    await selectAllIn(page, 'ta');
    await triggerRewrite(worker);
    await expect(card(page)).toContainText(EXPECTED_REWRITE);

    // Roving tabIndex means the inactive tab is not a tab stop; without an
    // arrow handler it was unreachable by keyboard entirely.
    await page.getByRole('tab', { name: 'Rewrite' }).focus();
    await page.keyboard.press('ArrowRight');

    await expect(page.getByRole('tab', { name: 'Translate' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const focusedTab = await page.evaluate(() => {
      const host = document.getElementById('rewrite-ai-root');
      return host?.shadowRoot?.activeElement?.textContent ?? null;
    });
    expect(focusedTab).toBe('Translate');
  });

  /**
   * The picker unmounts while holding focus. Without an explicit hand-back,
   * focus falls to the page body — outside the shadow root, where the card's
   * focus trap can no longer see it.
   */
  test('returns focus to the gear after choosing a language', async ({
    context,
    worker,
    pageUrl,
  }) => {
    const page = await context.newPage();
    await page.goto(pageUrl);
    await selectAllIn(page, 'ta');
    await triggerRewrite(worker);
    await expect(card(page)).toContainText(EXPECTED_REWRITE);

    await page.getByRole('tab', { name: 'Translate' }).click();
    await page.getByRole('button', { name: /Language: English/ }).click();
    await page.getByLabel(/Translate into/).selectOption('German');

    await expect
      .poll(() =>
        page.evaluate(() => {
          const host = document.getElementById('rewrite-ai-root');
          const active = host?.shadowRoot?.activeElement;
          return (
            active?.getAttribute('aria-label') ??
            document.activeElement?.tagName ??
            null
          );
        }),
      )
      .toMatch(/Language:/);
  });

  /** Invalid HTML, and it leaked the gear's label into the tab's own name. */
  test('does not nest the gear inside a tab button', async ({
    context,
    worker,
    pageUrl,
  }) => {
    const page = await context.newPage();
    await page.goto(pageUrl);
    await selectAllIn(page, 'ta');
    await triggerRewrite(worker);
    await expect(card(page)).toContainText(EXPECTED_REWRITE);
    await page.getByRole('tab', { name: 'Translate' }).click();

    const nested = await page.evaluate(() => {
      const host = document.getElementById('rewrite-ai-root');
      const gear = host?.shadowRoot?.querySelector('.card__tab-gear');
      return gear?.closest('[role="tab"]') !== null && gear !== undefined
        ? Boolean(gear?.closest('[role="tab"]'))
        : false;
    });
    expect(nested).toBe(false);
  });

  /** WCAG 2.2 SC 2.5.8: 24x24 CSS px minimum for a pointer target. */
  test('gives every icon-only control a 24px target', async ({
    context,
    worker,
    pageUrl,
  }) => {
    const page = await context.newPage();
    await page.goto(pageUrl);
    await selectAllIn(page, 'ta');
    await triggerRewrite(worker);
    await expect(card(page)).toContainText(EXPECTED_REWRITE);
    await page.getByRole('tab', { name: 'Translate' }).click();

    const sizes = await page.evaluate(() => {
      const root = document.getElementById('rewrite-ai-root')!.shadowRoot!;
      return ['.card__tab-gear', '.card__button--ghost'].map((selector) => {
        const box = root.querySelector(selector)!.getBoundingClientRect();
        return { selector, width: box.width, height: box.height };
      });
    });

    for (const { selector, width, height } of sizes) {
      expect(width, selector).toBeGreaterThanOrEqual(24);
      expect(height, selector).toBeGreaterThanOrEqual(24);
    }
  });
});

test.describe('replacement', () => {
  test.beforeEach(async ({ seedSettings }) => {
    await seedSettings();
  });

  /**
   * Replacement must substitute the original selection, not append to it. The
   * card steals focus on open, which collapses the selection in a real browser —
   * so re-reading the offsets at replace time appended the rewrite while still
   * reporting success.
   */
  for (const field of [
    {
      id: 'ta',
      label: 'textarea',
      original: 'their going to the meating tomorow',
    },
    { id: 'inp', label: 'input', original: 'recieve the pakage' },
  ]) {
    test(`substitutes the selected text in a ${field.label}`, async ({
      context,
      worker,
      pageUrl,
    }) => {
      const page = await context.newPage();
      await page.goto(pageUrl);

      // Select the whole field, the way a user would before right-clicking.
      await page.locator(`#${field.id}`).focus();
      await page.evaluate((id) => {
        const el = document.getElementById(id) as
          HTMLInputElement | HTMLTextAreaElement;
        el.setSelectionRange(0, el.value.length);
      }, field.id);

      await triggerRewrite(worker);
      await expect(card(page)).toContainText(EXPECTED_REWRITE);

      await page.getByRole('button', { name: /^Replace$/ }).click();

      await expect(page.locator(`#${field.id}`)).toHaveValue(EXPECTED_REWRITE);
      // Appending rather than replacing was the actual bug.
      const value = await page.locator(`#${field.id}`).inputValue();
      expect(value).not.toContain(field.original);

      await expectUndoRestores(page, field.id, field.original);
    });
  }

  /**
   * The reported bug, in the editor shape it was reported from: "it adds the
   * generated text next to the one that should be replaced".
   *
   * A rich editor gives us only a Range, and clicking Replace moves the page
   * selection. If the captured range is the selection's own range it collapses
   * along with it, and `insertText` then writes at a caret beside the original
   * instead of over it. Only a real browser has a real selection to collapse.
   */
  test('substitutes the selected text in a contenteditable', async ({
    context,
    worker,
    pageUrl,
  }) => {
    const original = 'their going to the meating tomorow';
    const page = await context.newPage();
    await page.goto(pageUrl);

    await selectAllInEditable(page, 'ce');
    await triggerRewrite(worker);
    await expect(card(page)).toContainText(EXPECTED_REWRITE);
    await page.getByRole('button', { name: /^Replace$/ }).click();

    await expect(page.locator('#ce')).toHaveText(EXPECTED_REWRITE);
    const text = await page.locator('#ce').innerText();
    expect(text).not.toContain(original);

    await expectUndoRestores(page, 'ce', original);
  });

  /**
   * The same thing in a framework editor that owns its document.
   *
   * `execCommand('insertText')` dispatches no `beforeinput`, so an editor that
   * builds its model from that event never learns of the edit and reverts it on
   * the next reconcile — while the card still reported "Replaced". The edit has
   * to be offered to the editor through the hook it actually listens to.
   */
  test('substitutes in an editor that owns its own document', async ({
    context,
    worker,
    pageUrl,
  }) => {
    const original = 'their going to the meating tomorow';
    const page = await context.newPage();
    await page.goto(pageUrl);

    await selectAllInEditable(page, 'ce-model');
    await triggerRewrite(worker);
    await expect(card(page)).toContainText(EXPECTED_REWRITE);
    await page.getByRole('button', { name: /^Replace$/ }).click();

    await expect(page.locator('#ce-model')).toHaveText(EXPECTED_REWRITE);
    const text = await page.locator('#ce-model').innerText();
    expect(text).not.toContain(original);
  });
});

/**
 * When it cannot be done, say so accurately.
 *
 * No amount of correct sequencing can make an editor that ignores every hook
 * substitute anything. What must not happen is the card claiming success — or
 * saying "Copied instead", which reads as "your field was left alone" while a
 * doubled message sits in it.
 */
test.describe('an editor that cannot be persuaded', () => {
  test.beforeEach(async ({ seedSettings }) => {
    await seedSettings();
  });

  test('admits the field needs checking instead of claiming success', async ({
    context,
    worker,
    pageUrl,
  }) => {
    const page = await context.newPage();
    await page.goto(pageUrl);

    await selectAllInEditable(page, 'ce-hostile');
    await triggerRewrite(worker);
    await expect(card(page)).toContainText(EXPECTED_REWRITE);

    await page.getByRole('button', { name: /^Replace$/ }).click();

    await expect(
      page.getByRole('button', { name: /Copied — check the field/ }),
    ).toBeVisible();
    // And it stays open, rather than auto-dismissing over a broken result.
    await expect(card(page)).toBeVisible();
  });
});

/**
 * The real editor from the bug report.
 *
 * WhatsApp Web's composer is Lexical. Every hand-written stand-in in fixtures.ts
 * passed while the extension was still appending the rewrite in the actual
 * product, so this mounts Lexical itself from npm — the only test here that can
 * settle whether the fix works.
 */
test.describe('a real Lexical editor', () => {
  test.beforeEach(async ({ seedSettings }) => {
    await seedSettings();
  });

  test('substitutes the selection rather than adding to it', async ({
    context,
    worker,
    lexicalUrl,
  }) => {
    const page = await context.newPage();
    await page.goto(lexicalUrl);
    // Lexical mounts and commits its initial state asynchronously.
    await expect(page.locator('#editor')).toContainText(LEXICAL_ORIGINAL);

    await selectAllInEditable(page, 'editor');
    await triggerRewrite(worker);
    await expect(card(page)).toContainText(EXPECTED_REWRITE);

    await page.getByRole('button', { name: /^Replace$/ }).click();

    // Lexical's own document, not just the DOM: the DOM can hold text Lexical is
    // about to revert, which is how a replacement could look successful and then
    // vanish.
    await expect
      .poll(() => page.evaluate(() => window.__lexicalText?.() ?? ''))
      .toBe(EXPECTED_REWRITE);

    const dom = await page.locator('#editor').innerText();
    expect(dom).toBe(EXPECTED_REWRITE);
    // The reported symptom, asserted directly: "message 1. message 2".
    expect(dom).not.toContain(LEXICAL_ORIGINAL);

    /**
     * Undo goes through Lexical's own history plugin here, not the browser's
     * native stack: the edit was offered as a `beforeinput` the editor claimed,
     * so it is Lexical's to reverse. Asserted against its document for the same
     * reason the substitution is.
     */
    await page.locator('#editor').focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect
      .poll(() => page.evaluate(() => window.__lexicalText?.() ?? ''))
      .toBe(LEXICAL_ORIGINAL);
  });
});

test.describe('content script recovery', () => {
  test.beforeEach(async ({ seedSettings }) => {
    await seedSettings();
  });

  /**
   * A freshly loaded page must work on the *first* request. Injecting the loader
   * and immediately resending lost a race against its dynamic import, so the
   * first click was silently dropped and only the second worked.
   *
   * The pre-existing-tab case cannot be constructed here — a persistent context
   * loads the extension before any tab exists — so the PING backoff itself is
   * covered by tests/background/tabs.test.ts.
   */
  test('delivers on the first request to a newly loaded page', async ({
    context,
    worker,
    pageUrl,
  }) => {
    const page = await context.newPage();
    await page.goto(pageUrl);
    await selectAllIn(page, 'ta');

    expect(await triggerRewrite(worker)).toEqual({ ok: true });
    await expect(card(page)).toBeVisible();
  });
});
