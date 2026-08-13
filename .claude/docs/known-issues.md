# Known issues and deferred work

Everything deliberately left open, with enough context to pick it up. Kept current
— if something here contradicts the code, the doc is the bug.

## What has and has not been verified in a browser

`pnpm test:e2e` loads the built extension in Chromium and drives it, so these are
verified rather than assumed:

- The floating card is visible **and hit-testable** above a page overlay at
  `z-index: 9999` — the assertion that caught the missing `z-index` on the shadow
  host, which had made the card invisible on Gmail, Slack and anything with a
  sticky header.
- The inline trigger the same: it appears on selecting text in a textarea or a
  text input, does **not** appear over read-only text, hides when the selection
  collapses, and opens the card when clicked.
- A rewrite streams end to end through a stubbed local provider.
- Replacement **substitutes rather than appends** in both a real `<textarea>` and
  a real `<input>`.
- The popup and options pages render with their token stylesheet applied.
- Context menus build with no errors, and the service worker registers cleanly.

**Still unverified, and it needs a human with a real browser:**

- **Real editors** — Gmail, Slack, Notion. Contenteditable replacement is where
  the captured-range logic earns its keep, and the native undo stack after
  `execCommand('insertText')` has never been checked.
- **Iframes** under `all_frames: true`. Context-menu clicks are frame-targeted;
  `Ctrl+Shift+D` is broadcast and relies on frames without a selection doing
  nothing.
- Whether an aborted `fetch` genuinely tears the connection down — visible only
  in the Network panel.
- Service-worker eviction mid-stream.
- Ollama's CORS behaviour, which depends on the user's `OLLAMA_ORIGINS`.

## The selection watcher has not been tested on a heavy editor

`src/content/trigger.ts` listens for `selectionchange` (plus `mouseup`/`keyup`) on
every frame of every page. This is the first part of the extension to run
continuously rather than sitting inert until messaged, so it is the first that
could plausibly slow a host page down.

The hot path is deliberately cheap — it bails before touching the DOM unless the
selection is inside an editable field, and coalesces into one animation frame so a
drag-select does not queue a measurement per `mousemove`. But **Notion and Google
Docs have not been tried.** Watch for typing lag and console noise there.

## Store screenshots show a UI that no longer exists

Dimensions are fixed: `store-assets/upload/` holds everything at the exact sizes
the Web Store requires, built by `scripts/build_store_assets.py`. What remains is
a **content** problem, and it has got worse rather than better.

The screenshots predate two reworks, so they now misrepresent the extension's
primary interaction:

- They show no **inline Rewrite button** at all, which is now the main way the
  feature is used.
- Tone pills read `Informational`/`Funny` alongside the old set; the code now
  offers Edge's five — Professional, Casual, Enthusiastic, Informational, Funny —
  as text-only pills with no emoji.
- Format pills read `Paragraph, Bullets, Email, Formal Letter, Summary, List`;
  `FORMAT_OPTIONS` has four: Paragraph, Email, Ideas, Blog post.
- Groq presets read `mixtral-8x7b`, `gemma2-9b`, `qwen2.5-72b`; `PROVIDERS` lists
  two. The popup also shows a `v1.2.0` badge and a "Rate us" link that do not
  exist.

Web Store review requires screenshots to represent the extension accurately, so
this is a rejection risk on its own. The fix is real captures of the built
extension at 1280×800 — see `/build-extension` — dropped into
`store-assets/source/` and re-run through the script. It needs a browser.

The 1400×560 marquee tile is also unbuilt. It is optional, and no source is close
to 2.5∶1, so it wants purpose-built artwork rather than a 37% vertical crop.

## Accepted tradeoffs

Not bugs. Documented so nobody "fixes" them without knowing the reason.

- **The context menu uses `contexts: ['editable']`.** Chrome cannot AND two
  contexts, so this is the closest match to Edge's "editable field with something
  selected". The cost is that the submenu is visible in a text field even with
  nothing selected, where clicking does nothing.
- **The inline trigger resolves the theme once**, at registration. Changing the
  theme mid-session leaves the button stale until the page reloads. Subscribing
  would put a `chrome.storage` listener in every frame of every page for something
  purely cosmetic; the card, which opens rarely, re-resolves each time.
- **`Ctrl+Shift+D` overrides Chrome's own "save all tabs as bookmarks".** The
  extension command wins, and users can rebind at
  `chrome://extensions/shortcuts`. Chosen over Edge's `Alt+I` so the two do not
  clash for anyone running both browsers.

## No release has been published

`release.yml` builds a zip and creates a GitHub release, but there is no Chrome
Web Store publish step; adding one needs store credentials in repository secrets.
The `package.json` `repository` field points at `github.com/rewrite-ai/rewrite-ai`,
which has not been verified as the real remote.

## Untested by design

- **`src/background/index.ts`** — excluded from coverage. It is registration only;
  the modules it wires are covered individually, and testing it would mean
  asserting that `addListener` was called.
- **`src/popup/index.tsx`, `src/options/index.tsx`** — excluded for the same reason.
- **Type-only modules** (`src/shared/types.ts`, `src/ai/types.ts`) — no runtime
  code to cover.

Coverage sits well above the enforced 80% floor.

## Smaller things

- **`prefers-reduced-motion`** is honoured via a media query in `tokens.css`, which
  zeroes durations globally. The spinner still spins, just instantly — a static
  indicator would be better.
- **Emoji in the popup tabs** (`⚙️ Setup`, `🧪 Playground`, `ℹ️ Info`), marked
  `aria-hidden`. The card and its adjust drawer now use real inline SVGs; the
  popup has not been given the same treatment.
- **Contrast** was fixed by replacing blanket `opacity: 0.5` on disabled controls
  with explicit token colours. The palette has not been audited with an automated
  checker.
- **No undo affordance in the card.** After Replace, recovery depends on the
  browser's native undo stack, which the code preserves by preferring
  `execCommand('insertText')` — but see the unverified list above.
