# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed — reported from real browser use

- **The rewrite no longer lands beside the original in WhatsApp Web.** Reported as
  "message 1. message 2", and reproduced offline against a real Lexical editor
  mounted from npm. The cause was one omission: a script-constructed `InputEvent`
  carries no target ranges, and Lexical, Slate and Quill all read the range to
  replace from `getTargetRanges()` rather than from the DOM selection — so Lexical
  declined the event, `execCommand` ran, and Lexical then re-applied the text at its
  own cached caret. The offer now carries target ranges built from the captured
  range, and Lexical takes the edit through its own pipeline. Confirmed against
  `playground.lexical.dev` as well.
- **The wrong element was being measured.** Every descendant of a `contenteditable`
  reports `isContentEditable`, so resolving the "nearest editable" landed on the
  inner `<span>` of Lexical's `<div><p><span>` shape — the wrong element to focus,
  and the wrong text to compare, which made an append into a sibling node invisible.
  The outermost editable element is now used.
- **Verification no longer runs too early, or rejects a good rewrite.** Lexical
  commits in a microtask and reverts foreign DOM from a `MutationObserver`, so the
  check now waits a frame and a task. It compares by length arithmetic on
  whitespace-stripped text, which an append fails and a legitimate Expand passes —
  the previous test rejected every Expand, since an expansion contains its original.
- **The model no longer answers the text instead of rewriting it.** The user turn
  was the bare selection, which to a chat model *is* a message addressed to it. It
  is now framed: the task named, the text inside a `<source_text>` delimiter, and the
  rule restated after the content, where a causal-attention model actually weighs it.
  The user turn stands alone, because Gemma has no system role and Mistral has no
  system token — on Ollama the system prompt is glued into the user turn or dropped
  outright, and `mistral` is a model this extension suggests. Built at the single
  choke point in `streamHandler`, so all seven providers get it and none changed.
- **New honest outcomes.** "No change needed" when the rewrite matches what you
  wrote, and "Copied — check the field" when the page was altered but not verifiably
  substituted, replacing a "Copied instead" that read as "your field was untouched".
- **The default rewrite no longer pads.** A real message came back 43% longer, with a
  terse arrow-notation instruction list turned into flowing prose — because the
  `improve` objective asked to "enhance sentence flow, vocabulary, and readability",
  which beat the system prompt's rule about matching length by being the more specific
  instruction. Improve Writing now tightens rather than enriches, keeping every detail;
  the system rules require the result to be no longer than the source and to preserve
  shorthand as shorthand. Expand and the Long adjustment still override it.

**Verified on WhatsApp Web itself**, by hand: the editor claimed the edit through
`beforeinput` and the substitution verified. Still unverified: Ctrl+Z after a
replacement, Quill sites (deliberately left on the previous code path), and whether the
model's behaviour changed — that needs a real key, which CI does not have.

- **A long suggestion no longer hides the buttons.** The card had no ceiling: only
  its output area was capped, so a long rewrite grew the card from its ~220px
  estimate to ~400px — 530px with Adjust open — and on a short viewport (a laptop
  window, or any window at 125%+ zoom) the action bar ended up below the fold.
  Because the card is `position: fixed`, nothing could scroll it back into view.
  The card is now capped to the viewport with its header and action bar pinned and
  the suggestion area scrolling, which is how Edge's panel behaves. Verified in
  Chromium at 1280×380, with the drawer both closed and open: before the fix the
  card's bottom sat 168px below the fold.
- **The rewrite no longer lands beside the original in a rich editor.**
  `execCommand('insertText')` dispatches no `beforeinput` — confirmed against
  Chromium — and editors that build their document from that event (Lexical,
  ProseMirror, Slate, as used by WhatsApp Web, Facebook and LinkedIn) therefore
  never learned of the edit: they reverted it on the next reconcile, or left the
  new text alongside the old. The edit is now offered to the editor through
  `beforeinput` first, and if it takes ownership the insert is not repeated.
- **The card can no longer claim "Replaced" for an edit that did not happen.** The
  contenteditable path now verifies the outcome against the host's text and
  reports `Copied instead` when the original survived — a substitution removes the
  text it replaced, so previous content surviving intact means the rewrite was
  added rather than substituted. It also refuses to insert at all when the
  selection cannot be restored, since inserting into a caret is what puts the
  rewrite beside the original.
- **The captured range is a snapshot.** `getRangeAt(0)` returns the object the
  selection itself holds, so moving that range's boundaries while inserting wrote
  into the page's live selection.

### Changed — parity with Edge's "Rewrite with Copilot"

The project always named Edge's Rewrite panel as its target, but the resemblance
was two code comments and a palette described as "Fluent-derived" that matched no
published Fluent ramp. These changes make it real.

- **The rewrite is now offered inline.** A small **Rewrite** button appears beside
  the selection the moment you select text in an editable field, as Edge's does —
  no right-click, no menu hunting. This is the interaction that makes the feature
  feel native, and it was the largest gap. The button lives in its own shadow
  surface so it can persist while no card exists and vanish when one opens.
- **The keyboard shortcut is `Ctrl+Shift+D`** (`Command+Shift+D` on macOS), was
  `Alt+H`. The inline button shows the live binding rather than a hardcoded
  string, so rebinding at `chrome://extensions/shortcuts` stays truthful.
- **Editable fields only, as in Edge.** The feature is no longer offered over
  read-only page text, where Replace could only fall back to a clipboard copy and
  relabel itself "Copied instead" — a confusing thing to discover after the fact.
  Every card that opens can now be applied. The context menu moved to
  `contexts: ['editable']`; the tradeoff is that the submenu is now visible in a
  text field even with nothing selected.
- **Edge's exact tone list restored:** Professional, Casual, Enthusiastic,
  **Informational**, Funny. An earlier fix for a mislabelled pill had replaced
  `informational` with an invented `informal` + `neutral` pair. Format and length
  already matched.
- **Adjust options are text-only** and the three category tabs have proper inline
  SVG icons, replacing sixteen emoji — the most conspicuously non-native detail in
  the card. A sparkle glyph now leads the card header, as Edge's does.
- The seven named actions (Improve Writing, Fix Grammar, Translate and the rest)
  remain on the right-click menu; the inline button and the shortcut perform a
  plain Rewrite, matching Edge's single action steered by Adjust.

Edge's own wording — "Rewrite with Copilot" — is deliberately **not** copied.
Copilot is a Microsoft trademark and using it would fail Chrome Web Store review
for impersonating another product.

### Fixed

- The content script no longer reads the settings object to get the theme. It
  asks the worker for that one field, so the API key stays out of a process shared
  with the page — the rule the codebase already documented and had quietly broken.
- Replace and Copy stayed enabled after an error, offering to act on text the
  output area had replaced with the error message.
- Arrow keys in the Adjust tab strip changed the selection without moving DOM
  focus, stranding keyboard users on an element that had just become untabbable.
- The Copy button had no tooltip or accessible name, unlike its three siblings.
- The "AI generated" chip hardcoded a raw colour instead of using a token.
- Removed `CARD.maxHeight`, dead since the card-positioning fix.

- **The floating card was invisible on most real sites.** Nothing in the codebase
  set a `z-index`, so the shadow host — positioned with `z-index: auto` — created
  no stacking context and its whole subtree painted behind every page element
  with `z-index >= 1`. On Gmail, Slack, Notion or anything with a sticky header
  the card mounted, streamed and billed without ever being seen.
- **The first right-click on a tab that predated the extension was dropped.** The
  worker injected the content script and resent immediately, but injection only
  runs a loader that fires a dynamic `import()` and returns — so the resend raced
  a 225 KB module graph and lost. The worker now polls a `PING` until the script
  answers before delivering.
- **Seven "Cannot find menu item" errors and no context menu at all.** Two
  overlapping menu rebuilds interleaved, the second `removeAll()` deleting the
  parent between the first's parent-create and its children. Rebuilds are now
  serialized, and a failed parent is reported once instead of cascading.
- Context-menu requests were broadcast to every frame in the tab, so a page with
  ad iframes opened one card and billed one request **per frame**. The clicked
  frame is now targeted directly.
- Replacing text appended the rewrite instead of substituting it, while still
  reporting "Replaced". Selection offsets are captured up front rather than
  re-read after the card has taken focus and a controlled field has collapsed
  the selection.
- The card was positioned using its worst-case drawer-open height as if that
  were its actual height, placing it up to 90px above the text it was rewriting
  and, on short viewports, at a fixed offset that ignored the selection. It now
  uses its measured height and repositions when the drawer changes it.
- The card could not be dismissed by clicking away on Gmail, Slack or Notion,
  which stop `mousedown` propagation; the listener now uses the capture phase.
- Native widgets — scrollbars, number spinners, select popups — rendered light
  against the dark palette. Added `color-scheme`.
- The shortcut row lost its layout on the popup and options page: it used a class
  defined only in the content script's shadow stylesheet.
- Every keystroke in the popup wrote to `chrome.storage`, and the async change
  echo could overwrite newer keystrokes, dropping characters. Writes are now
  debounced and the extension ignores the echo of its own write.
- Switching popup tabs silently cancelled an in-flight generation and discarded
  the result; panels now stay mounted.
- With streaming disabled the 90s request timeout could never fire, because
  nothing reset the service worker's idle timer and the worker was evicted first.
  The non-streaming ceiling is now below that budget.
- Removed `optional_host_permissions`, which requested `https://*/*` and was
  never used.

- Replacing text in an `<input>` always failed and silently fell back to a
  clipboard copy while reporting "Replaced". The native value setter was
  resolved from the wrong prototype.
- The card reported "Replaced" for any fallback path. It now distinguishes
  replaced, copied, and failed.
- The card was positioned off-screen for selections in a form field on a
  scrolled page: viewport coordinates had a scroll offset added to them.
- Changing an Adjust option or closing the card mid-stream left the abandoned
  request running to completion and raised an unhandled rejection in the service
  worker. Requests are now cancelled with `AbortController`.
- Generations now time out after 90 seconds instead of spinning indefinitely.
- Provider errors reported inside an HTTP 200 stream were dropped, so the user
  received silently truncated text. They are now surfaced.
- An empty completion was reported as success, clearing the spinner and leaving
  a blank card.
- A 401 on the non-streaming path reported a raw provider error rather than
  "invalid API key". Status mapping is now shared across all response paths.
- The content-script recovery path injected a hardcoded build hash that could
  never match, and never resent the message. Paths are now read from the
  manifest at runtime.
- Context menus were rebuilt on every service-worker wake, racing the install
  handler into a duplicate-id failure that nothing observed.
- `Ctrl+Enter` reached the host page as well as the card, sending the message in
  Gmail and Slack mid-replacement. Escape could be swallowed by the page before
  the card saw it.
- The card became permanently invisible for the rest of a page's life if the host
  element was removed externally, such as by an SPA route change.
- Selections in iframes opened the card pinned to the top-left corner.
- The tone pill labelled "Funny" asked the model for a neutral, objective tone;
  "Informational" asked for an informal one.
- Five `setTimeout` calls updated state after their component or popup had gone.
- `input[type=email]` was treated as a selectable text field, but the selection
  APIs throw on it.

### Security

- The plaintext API key was loaded into the content script on every page, into a
  state variable that was never read. It now stays in the service worker.
- Base URLs are validated: `https` only, or `http` on loopback. Switching
  provider clears a base URL the new provider does not use — previously a base
  URL configured for a custom server could redirect an OpenAI key to that host.
- The Gemini key moved out of the URL query string into the `x-goog-api-key`
  header, keeping it out of server, proxy and `chrome://net-export` logs.
- A custom provider with no base URL now errors instead of silently sending the
  key to `api.openai.com`.
- Messages crossing a process boundary are validated with Zod, including a
  length cap on the input text, which was previously unbounded.
- `host_permissions` are declared for the provider origins.
- Fixed the Anthropic browser-access header, which was unprefixed and therefore
  rejected at CORS preflight.
- 12.6 MB of unreferenced store screenshots were exposed to every page via
  `web_accessible_resources` and shipped inside the extension. They now live in
  `store-assets/`, outside the bundle.

### Changed

- Providers share one OpenAI-compatible base class; the six implementations were
  near-identical copies that had drifted apart.
- The popup and options page share one settings form, one settings hook and one
  streaming client. They previously each had their own and had diverged in six
  observable ways.
- Provider labels, default models and action titles have one definition each,
  down from two to four.
- Tailwind, PostCSS and autoprefixer removed — the pipeline was configured but
  produced no CSS at all. Replaced with a CSS-custom-property token system
  shared by all three surfaces.
- The stored `theme` and `maxTokens` settings are now editable and honoured;
  both were previously persisted but read nowhere.
- The floating card is a labelled `role="dialog"` with focus management, a focus
  trap, live-region announcements, real tab semantics and reduced-motion
  support. None of this existed before.
- `RewriteCard.tsx` (585 lines) and `popup/App.tsx` (578 lines) split into
  focused components and hooks.
- Seven single-prompt files consolidated into one definitions module.
- Every `any` removed from the source tree; provider responses are navigated
  through typed guards.

- Store listing assets rebuilt to the exact dimensions the Chrome Web Store
  requires — 1280×800 screenshots, a 440×280 promotional tile, and a 128×128
  store icon with its artwork at 96×96. Every one was previously the wrong size
  and would have been rejected on upload. Generated by
  `scripts/build_store_assets.py`; the oversized originals stay out of git.
- Toolbar icons regenerated from the store artwork. They previously used
  different art from the listing icon and the mark filled only 38–62% of the
  frame, so it read as a speck; it is now a plated mark legible at 16px.

### Added

- A Playwright smoke test (`pnpm test:e2e`) that loads the built extension in
  Chromium and drives it: asserts the card is visible **and hit-testable above a
  `z-index: 9999` page overlay**, that a rewrite streams end to end through a
  stubbed provider, that replacement substitutes rather than appends in both a
  textarea and an input, and that both extension pages render with styles. Every
  bug above passed the unit suite, because jsdom performs no layout or paint.
- 366 tests, up from 12, with 80% coverage thresholds enforced by the test run.
- A Chrome API test double covering `tabs`, `scripting`, `commands` and ports.
- `pnpm verify` to run the whole gate.
- Version consistency check between the git tag, `package.json` and
  `manifest.json`.

### Removed

- Two orphaned root prototype files that were never built or typechecked.

## [1.0.0] - 2026-08-04

### Added

- Initial release.
- Seven rewrite actions: improve, fix grammar, make professional, make friendly,
  make concise, expand, translate.
- Seven providers: OpenAI, Groq, Google Gemini, Anthropic Claude, OpenRouter,
  Ollama, and custom OpenAI-compatible servers.
- Floating card rendered in an isolated Shadow DOM with streaming output.
- Adjust drawer for tone, format and length.
- `Alt+H` keyboard shortcut and a context menu with all seven actions.
- Options page and toolbar popup for configuration.
- Settings validated with Zod and stored in `chrome.storage.local`.
