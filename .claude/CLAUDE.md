# Rewrite AI — project context

Chrome MV3 extension that rewrites selected text via one of seven AI providers.
TypeScript, React 18, Vite, `@crxjs/vite-plugin`, pnpm. No backend.

## Commands

```bash
pnpm verify          # typecheck + lint + format:check + test + build — the gate
pnpm dev             # Vite dev server with HMR
pnpm build           # production build into dist/
pnpm test            # unit tests
pnpm test:coverage   # tests with 80% thresholds enforced
pnpm typecheck       # tsc on src+tests, then on the config files
pnpm lint / lint:fix
pnpm format / format:check
pnpm check-version   # tag vs package.json vs manifest.json
```

```bash
pnpm test:e2e        # load dist/ in Chromium and drive it — needs a build first
```

Node >= 20, pnpm >= 9 (the lockfile is v9; **pnpm 8 cannot read it**).

Loading the built extension: `chrome://extensions` → Developer mode → Load unpacked → **`dist/`**. Never the project root: the root `manifest.json` is the build input and points at `.ts` sources, so Chrome accepts it and then fails to register the worker.

**Unit tests cannot see this class of bug.** jsdom does no layout and no paint. A missing `z-index` that put the card behind every page overlay, and a content script that was not listening when the worker messaged it, both passed 366 unit tests while the extension did not work at all. Anything about stacking, visibility, hit-testing, focus, or injection timing belongs in `tests/e2e/`.

## How a rewrite flows

```
inline Rewrite button (content/trigger.tsx) — the primary path
  → content/index.tsx          opens the card directly, no worker round trip

context menu click / Ctrl+Shift+D
  → background/index.ts        resolves the action, delivers to the clicked frame
  → background/tabs.ts         injects the content script if the tab lacks one, then resends
  → content/index.tsx          validates the message, opens the card
  → content/mount.ts           builds a shadow host + React root as a pair
  → RewriteCard                useStreamingRewrite opens a chrome.runtime port
  → background/streamHandler   validates, builds a provider, streams
  → ai/providers/*             fetch with an AbortSignal
  → ai/stream.ts               parses SSE or NDJSON into text chunks
  ← port messages              CHUNK* → DONE, or ERROR
  → content/replace.ts         writes the result back into the page
```

The **fetch happens in the service worker**, never the content script. That is what keeps the API key out of page processes.

## Layout

| Path              | Holds                                                                           |
| ----------------- | ------------------------------------------------------------------------------- |
| `src/ai/`         | Providers, streaming, factory, safe JSON navigation                             |
| `src/background/` | Service worker: context menus, tab messaging, port handler, Zod message schemas |
| `src/content/`    | Content script: selection watcher, inline trigger, replacement, the card        |
| `src/popup/`      | Toolbar popup (three tabs)                                                      |
| `src/options/`    | Options page                                                                    |
| `src/prompts/`    | Prompt definitions and adjustment phrasing                                      |
| `src/shared/`     | Constants, types, theme resolution, error narrowing                             |
| `src/storage/`    | `chrome.storage` wrapper and the settings schema                                |
| `src/styles/`     | Design tokens and per-surface stylesheets                                       |
| `src/ui/`         | Components and hooks shared by popup and options                                |

## Conventions

- **No `any` anywhere in `src/`.** ESLint enforces it. For provider responses use `dig`/`digString` from `src/ai/json.ts`; for caught values use `getErrorMessage` from `src/shared/errors.ts`.
- **Validate at boundaries with Zod.** `src/background/messages.ts` covers every cross-process message; `src/storage/settings.ts` covers persisted settings. New message type → new schema, `satisfies z.ZodType<TheSharedType>`.
- **One definition per fact.** `PROVIDERS` and `ACTIONS` in `src/shared/constants.ts` are the single sources for labels, default models and card titles. This file exists because those were previously defined in three or four places and had drifted.
- **Style with tokens.** No hex values in components. `src/styles/tokens.css` defines the palette (oklch), type scale, spacing, radii, durations. It is loaded into the shadow root via `?inline`.
- **Errors are explicit.** No empty catch. If a fallback changes what the user gets, the UI must say so — see `ReplaceOutcome`.

## MV3 gotchas that have already bitten this codebase

1. **Never hardcode a bundler output path.** Vite content hashes change every build. Read paths from `chrome.runtime.getManifest()`. A hardcoded `assets/index.tsx-loader-<hash>.js` silently broke content-script recovery for every rebuild.
2. **The service worker is terminated when idle.** Register on `onInstalled` + `onStartup`; never as a bare top-level side effect. A top-level `setupContextMenus()` re-ran on every wake and raced the install handler into a duplicate-id error.
3. **Always register `port.onDisconnect`.** The card disconnects its port on every Adjust click, Regenerate and unmount. Without a disconnect handler the streaming loop posts to a dead port, throws, and the catch block posts to the same dead port and throws again — an unhandled rejection in the worker.
4. **Thread an `AbortSignal` into every `fetch`.** Otherwise an abandoned generation keeps streaming from a paid API. `reader.cancel()`, not just `releaseLock()`.
5. **Check `chrome.runtime.lastError`** after callback-style APIs, or failures are completely invisible.
6. **The card is `position: fixed`,** so coordinates are viewport-relative. Adding `window.scrollY` puts it off-screen.
7. **Providers report errors inside HTTP 200 streams.** Give every parser an `extractError`, or output truncates silently.
8. **The API key belongs in the worker.** Do not import `loadSettings` into anything under `src/content/`.
9. **Selection APIs throw on `input[type=email|number]`.** Only text, search, url, tel and password support them.
10. **Register card key handlers — and the outside-click handler — in the capture phase, and stop propagation.** Otherwise `Ctrl+Enter` also fires the host page's binding, which in Gmail and Slack sends the message; and a bubble-phase `mousedown` never arrives at all on pages that stop propagation, leaving the card impossible to dismiss.
11. **The shadow host needs an explicit `z-index`.** A positioned host with `z-index: auto` creates no stacking context, so the whole shadow subtree paints behind any page element with `z-index >= 1`. This is why the card was invisible on Gmail and Slack. Put it on the host, not the card — the card's own stacking context cannot escape the host's paint slot.
12. **Injection completing is not readiness.** The bundler's content-script loader fires a dynamic `import()` and returns, so `executeScript` resolves while the module graph is still loading and `onMessage` is unregistered. Poll `PING` before delivering; never assume the script is listening.
13. **Capture selection offsets up front.** Opening the card moves focus off the field, and a controlled input collapses its selection on blur — re-reading `selectionStart` at replace time appends instead of replacing.
14. **The content script must not read settings.** It gets the theme by asking the worker for that one field — `GET_THEME`, handled in `src/background/themeBridge.ts`, called from `src/content/theme.ts`. The settings object carries the API key, and pulling it into a process shared with the page is what rule 8 exists to prevent. That rule was documented and then broken twice, which is why the mechanism now exists.
15. **A `position: fixed` card must be capped to the viewport, with its action bar pinned.** Nothing can scroll an overhanging fixed element into view, so an action bar below the fold is simply gone. `.card` caps itself with `--card-max-height`, injected into the shadow root from `CARD.margin` by `createShadowContainer`; the header and action bar are `flex: 0 0 auto` and the output and drawer shrink and scroll. The viewport clamp in `positionAnchored` is only correct _because_ of that cap — it reduces any height larger than the viewport, which silently permitted the overhang.
16. **A script-built `beforeinput` must carry `targetRanges`.** `new InputEvent(...)` produces an empty `getTargetRanges()`, and Lexical, Slate and Quill all read the range to replace from _there_, not from the DOM selection. That single omission was the WhatsApp Web bug: Lexical declined the event, `execCommand` ran, and Lexical re-applied the text at its own cached caret — "message 1. message 2". `targetRanges` is absent from MDN but present in Blink's IDL and honoured; verified in Chromium. `isTrusted: false` is not an obstacle — none of these editors check it.
17. **The editing host is the outermost editable element, not the nearest.** _Every_ descendant of a `contenteditable` reports `isContentEditable === true`, so a walk that stops at the first match lands on the inner `<span>` of Lexical's `<div contenteditable><p><span>`. That is the wrong element to focus and, worse, the wrong element to compare text against — an append landing in a sibling node is invisible to it.
18. **Yield a task, not a microtask or a frame, between restoring a selection and editing.** `selectionchange` is delivered by queuing a task, so `await Promise.resolve()` runs before any editor hears about the restored selection. `requestAnimationFrame` is worse than useless here: ~16ms lands inside the window where ProseMirror's focus handler overwrites the DOM selection with its own.
19. **Verify a contenteditable edit asynchronously.** Lexical commits in a microtask and reverts foreign DOM from a `MutationObserver`, both after the call returns, so a synchronous check reports success for an edit that is about to be undone. Compare by length arithmetic on whitespace-stripped text — `after == before − old + new` — because `textContent` loses the newlines a multi-paragraph rewrite contains, and because a legitimate Expand _contains_ the original, which a naive `!after.includes(before)` test rejects.
20. **`execCommand('insertText')` dispatches no `beforeinput`.** Editors that build their document from that event — Lexical, ProseMirror, Slate, so WhatsApp Web, Facebook, LinkedIn — never learn of an edit made that way and revert it on the next reconcile, or leave the new text beside the old. `replaceInContentEditable` offers the edit via a cancelable `beforeinput` first and does not insert again if the editor claims it. Never trust a `true` from `execCommand`: verify against the host's text, because a substitution removes what it replaced.
21. **Clone a captured Range.** `getRangeAt(0)` returns the object the selection itself holds — the same reference on every call — so moving its boundaries writes into the page's live selection.
22. **Never send the selected text as the whole user turn.** A bare user message _is_ a message addressed to the model, so it answers the user's draft instead of rewriting it — intermittently, since it is a first-token coin flip. `assemblePrompt` in `src/prompts/` frames it: the task named from `ACTIONS`, the text inside a `<source_text>` delimiter, and the rule restated _after_ the content, because attention is causal and the last tokens decide the first token out. The user turn must stand alone — Gemma has no system role at all and Mistral has no system token, so on Ollama a system message is glued into the user turn or dropped.
23. **Each in-page surface gets its own shadow host.** `mountSurface`/`unmountSurface` in `src/content/mount.ts` keep the React root and its host node as a pair, per surface (`card`, `trigger`). The inline trigger has to outlive the absence of a card and disappear when one opens, so they cannot share a host — and each host needs its own `z-index`, per rule 11.

## Testing

`tests/` mirrors `src/`. `tests/chromeMock.ts` is the Chrome API double and provides connected port pairs — prefer driving the real modules across a port (card → stream handler → stubbed fetch) over mocking the seam away. `tests/helpers/http.ts` builds SSE/NDJSON responses; use `stubFetchEach` when a test issues more than one request, since a `Response` body can only be read once.

Coverage thresholds are enforced at 80% in `vite.config.ts` and currently sit around 96%.
