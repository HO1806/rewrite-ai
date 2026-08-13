# Known issues and deferred work

Everything the cleanup pass deliberately left, with enough context to pick it up.

## Store screenshots show a UI that no longer exists

Dimensions are fixed — `store-assets/upload/` now holds everything at the exact
sizes the store requires, built by `scripts/build_store_assets.py`. What remains
is a **content** problem: the screenshots were generated before the code was
reworked and depict features that are gone.

- Tone pills read `Informational` / `Funny`; the code offers Professional, Casual,
  Enthusiastic, Informal, Neutral, Funny.
- Format pills read `Paragraph, Bullets, Email, Formal Letter, Summary, List`;
  `FORMAT_OPTIONS` has four.
- Groq presets read `mixtral-8x7b`, `gemma2-9b`, `qwen2.5-72b`; `PROVIDERS` lists
  two. The popup also shows a `v1.2.0` badge and a "Rate us" link that do not exist.

Web Store review requires screenshots to represent the extension accurately, so
this is a rejection risk on its own. The fix is real captures of the built
extension at 1280×800 — see `/build-extension` — dropped into `store-assets/source/`
and re-run through the script. Not doable from here: it needs a browser.

The 1400×560 marquee tile is also unbuilt. It is optional, and no source is close
to 2.5∶1, so it wants purpose-built artwork rather than a 37% vertical crop.

## No release has been published

`release.yml` builds a zip and creates a GitHub release, but there is no Chrome Web Store publish step. Adding one needs store credentials in repository secrets. The `package.json` `repository` field points at `github.com/rewrite-ai/rewrite-ai`, which has not been verified as the real remote.

## Untested by design

- **`src/background/index.ts`** — excluded from coverage. It is registration only; the modules it wires are covered individually, and testing it would mean testing that `addListener` was called.
- **`src/popup/index.tsx`, `src/options/index.tsx`** — excluded for the same reason.
- **Type-only modules** (`src/shared/types.ts`, `src/ai/types.ts`) — no runtime code to cover.

Coverage sits around 96% with an 80% floor enforced, so there is headroom.

## Nothing has been verified in a real browser

The whole pass was verified against the gate: typecheck, lint, format, 358 unit tests, production build. **No part of it has been loaded into Chrome.** The manual checklist in `/build-extension` exists precisely because these paths cannot be covered by jsdom:

- Real shadow-DOM rendering and stacking against arbitrary host-page CSS.
- Actual undo-stack behaviour after `execCommand('insertText')`.
- Contenteditable replacement in real editors (Gmail, Slack, Notion), which is where the captured-range logic earns its keep.
- Iframe selections now that `all_frames` is on.
- Whether an aborted `fetch` genuinely tears down the connection, observable only in the Network panel.
- Service-worker eviction mid-stream.
- Ollama's CORS behaviour, which depends on the user's `OLLAMA_ORIGINS`.

Treat the extension as unverified end to end until someone runs that list.

## Smaller things

- **`prefers-reduced-motion`** is honoured via a media query in `tokens.css`, which zeroes durations globally. The spinner still spins, just instantly — a static indicator would be better.
- **Emoji as icons.** The popup tabs and adjust pills use emoji, marked `aria-hidden` so screen readers skip them. A real icon set would be an improvement; the card already has proper SVGs.
- **`optional_host_permissions: ["https://*/*"]`** is broad, to let custom servers work without a manifest change per user. Narrowing this to a runtime grant flow would be tighter.
- **No E2E tests.** Playwright can drive a loaded extension; that would cover most of the manual checklist above. The `playwright-cli` skill is the token-efficient way in.
- **Contrast** was fixed by replacing blanket `opacity: 0.5` on disabled controls with explicit token colours. The token palette has not been formally audited with an automated checker.
