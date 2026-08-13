/**
 * Browser smoke test for the built extension.
 *
 * Every assertion here exists because the equivalent unit test could not fail.
 * jsdom has no layout and no paint, so a card rendering behind the page and a
 * content script that was not listening yet both passed the whole unit suite
 * while the extension was completely unusable in Chrome.
 */

import { EXPECTED_REWRITE, expect, test } from './fixtures';
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

    expect(
      await triggerRewrite(worker, 'The way we work is changing.'),
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

    await triggerRewrite(worker, 'their going to the meating tomorow');

    await expect(card(page)).toContainText(EXPECTED_REWRITE);
    await expect(page.getByRole('button', { name: /^Replace$/ })).toBeEnabled();
  });

  test('is dismissed by Escape', async ({ context, worker, pageUrl }) => {
    const page = await context.newPage();
    await page.goto(pageUrl);
    await triggerRewrite(worker, 'some text');
    await expect(card(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(card(page)).toHaveCount(0);
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

    expect(await triggerRewrite(worker, 'first attempt')).toEqual({ ok: true });
    await expect(card(page)).toBeVisible();
  });
});
