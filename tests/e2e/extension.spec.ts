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

/** Deliver a rewrite request, the way the context menu does. */
async function triggerRewrite(
  worker: Worker,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const tabId = await waitForContentScript(worker);

  return worker.evaluate(
    async ([id, selectionText]) => {
      try {
        await chrome.tabs.sendMessage(id as number, {
          type: 'REWRITE_REQUEST',
          action: 'improve',
          text: selectionText as string,
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
    [tabId, text] as const,
  );
}

/** The card lives in a shadow root; Playwright pierces it automatically. */
function card(page: Page) {
  return page.locator('#rewrite-ai-root .card');
}

/** The inline offer, in its own shadow host. */
function trigger(page: Page) {
  return page.locator('#rewrite-ai-trigger .trigger');
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
 * Announce the current selection until the content script reacts.
 *
 * `page.goto` resolves while the content script's dynamic import is still in
 * flight — the same race the worker's PING backoff exists for. A single
 * `selectionchange` dispatched straight after navigation can land before
 * `registerInlineTrigger` has run, and a missed event never comes back, so no
 * amount of assertion retrying recovers it. Re-announcing is safe: the watcher
 * re-reads the same live selection.
 */
async function announceSelection(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await page.evaluate(() =>
      document.dispatchEvent(new Event('selectionchange')),
    );
    if (await page.locator('#rewrite-ai-trigger').count()) return;
    await page.waitForTimeout(100);
  }
  throw new Error('the inline trigger never appeared');
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

  /**
   * The failure that put a red "Errors" badge on the extension card: a rebuild
   * racing another one deletes the parent between its create and the children's,
   * and all seven children fail with "Cannot find menu item".
   */
  test('builds its context menu without errors', async ({ worker }) => {
    const problems: string[] = [];
    worker.on('console', (message) => {
      if (message.type() === 'warning' || message.type() === 'error') {
        problems.push(message.text());
      }
    });

    // Give onInstalled's rebuild time to complete.
    await new Promise((r) => setTimeout(r, 2000));

    // The parent-cascade failure produced exactly this, seven times over, and
    // left no menu at all. Serialization of concurrent rebuilds is unit-tested
    // in tests/background/contextMenus.test.ts; extension events cannot be
    // dispatched from a page context.
    expect(
      problems.filter((line) => /Cannot find menu item/.test(line)),
    ).toEqual([]);
    expect(problems.filter((line) => /Could not create/.test(line))).toEqual(
      [],
    );
  });

  test('renders the popup with its stylesheet applied', async ({
    context,
    extensionId,
  }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

    await expect(popup.getByRole('tab', { name: /Setup/ })).toBeVisible();
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
    await expect(options.getByLabel(/Response limit/)).toBeVisible();
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

    expect(
      await triggerRewrite(worker, 'their going to the meating tomorow'),
    ).toEqual({ ok: true });

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

    await triggerRewrite(worker, 'their going to the meating tomorow');

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
    await triggerRewrite(worker, LONG_INPUT);

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

    // Opening Adjust adds another ~130px, so it is what overflows first.
    await page.getByRole('button', { name: /Adjust/ }).click();
    await expect
      .poll(() => page.evaluate(measureCard).then((m) => m.overhang))
      .toBeLessThanOrEqual(0);
    await expect(page.getByRole('button', { name: /^Replace$/ })).toBeVisible();
  });

  test('is dismissed by Escape', async ({ context, worker, pageUrl }) => {
    const page = await context.newPage();
    await page.goto(pageUrl);
    await selectAllIn(page, 'ta');
    await triggerRewrite(worker, 'some text');
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
test.describe('the inline trigger', () => {
  test.beforeEach(async ({ seedSettings }) => {
    await seedSettings();
  });

  test('appears on selecting text in a textarea, above a high z-index overlay', async ({
    context,
    pageUrl,
  }) => {
    const page = await context.newPage();
    await page.goto(pageUrl);

    await expect(trigger(page)).toHaveCount(0);
    await selectAllIn(page, 'ta');
    await announceSelection(page);

    await expect(trigger(page)).toBeVisible();
    await expect(trigger(page)).toContainText('Rewrite');

    // The same hit test that caught the missing z-index on the card: the button
    // must be what the user actually clicks, not the page's overlay.
    const topmost = await page.evaluate(() => {
      const host = document.getElementById('rewrite-ai-trigger')!;
      const box = host
        .shadowRoot!.querySelector('.trigger')!
        .getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
      return hit?.id ?? hit?.tagName ?? null;
    });
    expect(topmost).toBe('rewrite-ai-trigger');
  });

  test('appears for a text input too', async ({ context, pageUrl }) => {
    const page = await context.newPage();
    await page.goto(pageUrl);
    await selectAllIn(page, 'inp');
    await announceSelection(page);

    await expect(trigger(page)).toBeVisible();
  });

  /** The editable-only scope: no offer where the result could not be applied. */
  test('does not appear for read-only page text', async ({
    context,
    pageUrl,
  }) => {
    const page = await context.newPage();
    await page.goto(pageUrl);

    await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('para')!);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });

    await expect(page.locator('#rewrite-ai-trigger')).toHaveCount(0);
  });

  test('opens the card when clicked, and gets out of the way', async ({
    context,
    pageUrl,
  }) => {
    const page = await context.newPage();
    await page.goto(pageUrl);
    await selectAllIn(page, 'ta');
    await announceSelection(page);
    await expect(trigger(page)).toBeVisible();

    await trigger(page).click();

    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText(EXPECTED_REWRITE);
    // The offer must not linger behind the card it opened.
    await expect(page.locator('#rewrite-ai-trigger')).toHaveCount(0);
  });

  test('the whole flow works end to end from the button', async ({
    context,
    pageUrl,
  }) => {
    const page = await context.newPage();
    await page.goto(pageUrl);
    await selectAllIn(page, 'ta');
    await announceSelection(page);

    await trigger(page).click();
    await expect(card(page)).toContainText(EXPECTED_REWRITE);
    await page.getByRole('button', { name: /^Replace$/ }).click();

    await expect(page.locator('#ta')).toHaveValue(EXPECTED_REWRITE);
  });

  test('hides when the selection collapses', async ({ context, pageUrl }) => {
    const page = await context.newPage();
    await page.goto(pageUrl);
    await selectAllIn(page, 'ta');
    await announceSelection(page);
    await expect(trigger(page)).toBeVisible();

    await page.evaluate(() => {
      const el = document.getElementById('ta') as HTMLTextAreaElement;
      el.setSelectionRange(0, 0);
      document.dispatchEvent(new Event('selectionchange'));
    });

    await expect(page.locator('#rewrite-ai-trigger')).toHaveCount(0);
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

      await triggerRewrite(worker, field.original);
      await expect(card(page)).toContainText(EXPECTED_REWRITE);

      await page.getByRole('button', { name: /^Replace$/ }).click();

      await expect(page.locator(`#${field.id}`)).toHaveValue(EXPECTED_REWRITE);
      // Appending rather than replacing was the actual bug.
      const value = await page.locator(`#${field.id}`).inputValue();
      expect(value).not.toContain(field.original);
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
    pageUrl,
  }) => {
    const original = 'their going to the meating tomorow';
    const page = await context.newPage();
    await page.goto(pageUrl);

    await selectAllInEditable(page, 'ce');
    await announceSelection(page);
    await expect(trigger(page)).toBeVisible();

    // Real clicks throughout: the mousedown on each button is what moves the
    // selection, and that is the whole mechanism under test.
    await trigger(page).click();
    await expect(card(page)).toContainText(EXPECTED_REWRITE);
    await page.getByRole('button', { name: /^Replace$/ }).click();

    await expect(page.locator('#ce')).toHaveText(EXPECTED_REWRITE);
    const text = await page.locator('#ce').innerText();
    expect(text).not.toContain(original);
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
    pageUrl,
  }) => {
    const original = 'their going to the meating tomorow';
    const page = await context.newPage();
    await page.goto(pageUrl);

    await selectAllInEditable(page, 'ce-model');
    await announceSelection(page);

    await trigger(page).click();
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
    pageUrl,
  }) => {
    const page = await context.newPage();
    await page.goto(pageUrl);

    await selectAllInEditable(page, 'ce-hostile');
    await announceSelection(page);
    await trigger(page).click();
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
    lexicalUrl,
  }) => {
    const page = await context.newPage();
    await page.goto(lexicalUrl);
    // Lexical mounts and commits its initial state asynchronously.
    await expect(page.locator('#editor')).toContainText(LEXICAL_ORIGINAL);

    await selectAllInEditable(page, 'editor');
    await announceSelection(page);
    await trigger(page).click();
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

    expect(await triggerRewrite(worker, 'first attempt')).toEqual({ ok: true });
    await expect(card(page)).toBeVisible();
  });
});
