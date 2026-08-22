# ⚡ Rewrite AI

> Open-source browser extension that brings AI text editing to every webpage. Select text, press Ctrl+Shift+D, replace inline.

---

## Overview

**Rewrite AI** aims to feel like a native browser feature — inspired by Microsoft Edge's Rewrite tool, but open source, privacy-first, and provider-agnostic.

- **Fast and minimal.** No chat interface, no sidebar. The rewrite is offered inline the moment you select text.
- **Floating card.** Rendered beside your selection inside an isolated Shadow DOM, so page styles never bleed in and its styles never leak out.
- **Bring your own key.** No analytics, no telemetry, no accounts, no server relay. Requests go straight from the extension to the provider you configure.
- **Seven providers.** OpenAI, Groq, Google Gemini, Anthropic Claude, OpenRouter, Ollama (local), and any OpenAI-compatible server.

---

## Using it

1. **Select text** in any field you can type into — Gmail, WhatsApp Web, GitHub, Reddit and so on.
2. Press **`Ctrl+Shift+D`**. That is the only way in: there is no inline button and no right-click menu, by design. Rebind it at `chrome://extensions/shortcuts` if it clashes.
3. The **floating card** appears and streams the suggestion in. It opens on whichever tab you used last.
4. **Replace** (or `Ctrl+Enter`) swaps the text in place. **Copy** puts it on the clipboard. **Regenerate** tries again. **Escape** dismisses.

The feature is offered **only in editable fields**: if the result could not be written back, you are not offered the rewrite in the first place. Where a captured selection goes stale mid-rewrite, the button reports **Copied instead** rather than claiming a replacement it did not make — and **Copied — check the field** if the page was altered but the substitution could not be verified.

### The two tabs

| Tab           | What it does                                                                             |
| ------------- | ---------------------------------------------------------------------------------------- |
| **Rewrite**   | Judges how much change the text needs — corrects a clean sentence, rewrites a clumsy one |
| **Translate** | Translates the selection. The gear beside the tabs picks the language                    |

Arrow keys move between the tabs; the shortcut reopens whichever one you used last.

### Popup

Clicking the toolbar icon opens a single **Setup** panel: provider, API key, model and appearance, plus the live keyboard shortcut. **Load models** asks your provider which models the key can actually use, rated strongest-first.

---

## Architecture

```
[ Webpage text selection ]
          │  Ctrl+Shift+D
          ▼
[ Background service worker ]  ── fetch ──▶  [ AI provider ]
          │  chrome.runtime port: CHUNK / DONE / ERROR
          ▼
[ Content script floating card ]  (Shadow DOM)
```

The network request is made **in the background service worker**, not in the content script. That is deliberate: the API key never enters a page's process. Chunks are relayed to the card over a long-lived `chrome.runtime` port.

- **Manifest V3** event-driven service worker. Nothing assumes state survives between events.
- **Streaming** via `AsyncGenerator`, parsing SSE (most providers) and NDJSON (Ollama).
- **Cancellation** through `AbortController`: closing the card or changing an Adjust option aborts the in-flight request instead of paying for a result nobody will read.
- **Timeout** of 90 seconds per generation.

### Layout

```
src/
  ai/           provider implementations, streaming, factory
  background/   service worker: tab messaging, command handler, port handler
  content/      content script: selection, replacement, the floating card
  popup/        toolbar popup
  options/      options page
  prompts/      prompt definitions and adjustment phrasing
  shared/       constants, types, theme, error helpers
  storage/      chrome.storage wrapper and the settings schema
  styles/       design tokens and per-surface stylesheets
  ui/           components and hooks shared by popup and options
```

---

## Getting started

### Prerequisites

- Node.js >= 20
- pnpm >= 9 (the lockfile is v9; pnpm 8 cannot read it)

```bash
pnpm install

pnpm dev              # Vite dev server with hot reload
pnpm test             # unit tests
pnpm test:coverage    # unit tests with coverage thresholds
pnpm verify           # typecheck + lint + format + test + build
pnpm build            # production build into dist/
pnpm test:e2e         # load the built extension in Chromium and drive it
```

`pnpm test:e2e` needs a build first and a real browser, so it is deliberately not part of `pnpm verify`. It exists because jsdom has no layout and no paint: a card that rendered _behind_ the page, and a content script that was not listening yet, both passed the entire unit suite while the extension was unusable.

### Loading in Chrome or Edge

1. Run `pnpm build`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and choose the **`dist/`** directory.

> **Load `dist/`, not the project root.** The root also contains a `manifest.json` — it is the build _input_ and points at `.ts`/`.tsx` sources. Chrome accepts it, because it is structurally valid, and then nothing works at all: the browser cannot execute TypeScript, so the service worker fails to register and you get a red **Errors** badge on the extension card.

Tabs that were already open when you loaded the extension have no content script yet. The worker injects one on demand and waits for it to become ready before delivering, so the first press of the shortcut works — but reloading the page is still the quickest fix if anything looks stuck.

---

## Configuration

Open the options page by right-clicking the toolbar icon and choosing **Options**, or via **All settings** in the popup. (Clicking the icon itself opens the popup.)

| Setting            | Description                                                                       |
| ------------------ | --------------------------------------------------------------------------------- |
| **AI provider**    | OpenAI, Groq, Google Gemini, Anthropic Claude, OpenRouter, Ollama, custom server  |
| **API key**        | Stored in `chrome.storage.local` only — never `sync`, so it is not sent to Google |
| **Base URL**       | Only for Ollama and custom servers. Must be `https`, or `http` on localhost       |
| **Model**          | Free text, with per-provider presets                                              |
| **Creativity**     | Temperature, 0.0 – 2.0 (default 0.3)                                              |
| **Response limit** | Max tokens, 1 – 128000 (default 2048)                                             |
| **Translate into** | Target language for the Translate action (default English)                        |
| **Appearance**     | Light, dark, or match system                                                      |
| **Streaming**      | Show text as it is generated                                                      |

Your API key is sent only to the provider you select. Because a base URL determines where that key goes, switching provider clears any base URL the new provider does not use, and only `https` (or loopback `http`) is accepted.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: `pnpm verify` must pass, new code needs tests, and messages crossing a process boundary are validated with Zod.

## License

MIT. See [LICENSE](LICENSE).
