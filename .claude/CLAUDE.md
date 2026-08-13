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
15. **Each in-page surface gets its own shadow host.** `mountSurface`/`unmountSurface` in `src/content/mount.ts` keep the React root and its host node as a pair, per surface (`card`, `trigger`). The inline trigger has to outlive the absence of a card and disappear when one opens, so they cannot share a host — and each host needs its own `z-index`, per rule 11.

## Testing

`tests/` mirrors `src/`. `tests/chromeMock.ts` is the Chrome API double and provides connected port pairs — prefer driving the real modules across a port (card → stream handler → stubbed fetch) over mocking the seam away. `tests/helpers/http.ts` builds SSE/NDJSON responses; use `stubFetchEach` when a test issues more than one request, since a `Response` body can only be read once.

Coverage thresholds are enforced at 80% in `vite.config.ts` and currently sit around 96%.
