# Architecture

Three processes, one port protocol.

## Processes

| Process         | Entry                      | Runs                                | Holds the API key |
| --------------- | -------------------------- | ----------------------------------- | ----------------- |
| Service worker  | `src/background/index.ts`  | Event-driven, terminated when idle  | **Yes**           |
| Content script  | `src/content/index.tsx`    | Every page and frame (`<all_urls>`) | No                |
| Popup / options | `src/popup`, `src/options` | While open                          | Reads for editing |

The provider `fetch` happens **only** in the service worker. The content script never reads settings, so the key never enters a page's process — an isolated world still shares a process with the page.

## Request flow

1. **Trigger.** `chrome.contextMenus.onClicked` or `chrome.commands.onCommand` in [index.ts](../../src/background/index.ts). `menuItemId` is `string | number`, so it is matched against `ACTIONS` rather than cast.

2. **Delivery.** [tabs.ts](../../src/background/tabs.ts) `sendMessageToTab` tries `chrome.tabs.sendMessage`. On failure — a tab that predates the extension load — it injects the content script using paths read from `chrome.runtime.getManifest().content_scripts`, then **resends**. Failures are classified as `restricted-page`, `no-content-script`, or `unknown` rather than swallowed.

3. **Open the card.** [content/index.tsx](../../src/content/index.tsx) validates the message against `backgroundToContentMessageSchema`. It returns `undefined` for anything it does not handle, so it does not claim the response channel, and `false` for messages it answers synchronously.

   `buildSelectionInfo` prefers the live selection (`getSelectionInfo`) and falls back to the context menu's `selectionText`, centring the card when the selection is unmeasurable in this frame.

4. **Mount.** [mount.ts](../../src/content/mount.ts) creates a shadow host and a React root **as a pair** and always replaces both together. Caching the root independently of its mount node is what previously left the card permanently invisible once a host page removed the host element.

   [shadow.ts](../../src/content/shadow.ts) injects `tokens.css` + `card.css` via `?inline` into a `:host { all: initial }` shadow root.

5. **Stream.** `RewriteCard` calls [useStreamingRewrite](../../src/ui/hooks/useStreamingRewrite.ts), which opens a `chrome.runtime` port named `rewrite-ai-stream` and posts a `START_REWRITE`.

6. **Serve.** [streamHandler.ts](../../src/background/streamHandler.ts) creates one `StreamSession` per port. The session:
   - validates the request against `streamRequestSchema`, including a 20,000-character cap;
   - aborts any request already in flight on that port;
   - owns an `AbortController`, aborted on `port.onDisconnect` and by a 90-second timer;
   - loads settings, builds a provider via `buildProviderConfig` + `createProvider`;
   - relays `CHUNK` messages, guarded so it never posts to a closed port;
   - treats an empty completion as an error, not a success;
   - maps error codes to human sentences in `toUserMessage`, returning `null` for a deliberate cancellation so nothing is shown.

7. **Fetch.** Providers in [src/ai/providers](../../src/ai/providers) call `requestJson`, which attaches the signal and translates transport failures. OpenAI-dialect providers extend `OpenAICompatibleProvider`; the rest implement `AIProvider` directly.

8. **Parse.** [stream.ts](../../src/ai/stream.ts) exposes `parseSSEStream` (blank-line-delimited events, `data:` lines joined per spec) and `parseNDJSONStream` (Ollama). Both share `assertResponseOk` for status mapping and accept an `extractError` so provider failures inside an HTTP 200 stream surface instead of truncating output.

9. **Write back.** [replace.ts](../../src/content/replace.ts) returns a `ReplaceOutcome` of `replaced | copied | failed`. Form fields prefer `execCommand('insertText')` to preserve the undo stack, falling back to the native value setter resolved from the element's own prototype. Contenteditable checks the captured range is still connected before mutating.

## Port protocol

```
content → background   { type: 'START_REWRITE', action, text, adjustParams? }
background → content   { type: 'CHUNK', text }        zero or more
                       { type: 'DONE', fullText }     terminal, success
                       { type: 'ERROR', message }     terminal, failure
```

Both directions are validated in [messages.ts](../../src/background/messages.ts), each schema `satisfies z.ZodType<>` against the shared type so the two cannot drift.

A port closing without `DONE` or `ERROR` means the worker was evicted mid-stream; `useStreamingRewrite` surfaces that rather than leaving the UI spinning forever.

## Settings

[settings.ts](../../src/storage/settings.ts) owns a Zod schema and is the only writer. `loadSettings` merges stored values over defaults and self-heals to defaults on validation failure, logging field paths only — never values, which would put the key in the console.

`baseUrl` accepts `https`, or `http` on loopback. `buildProviderConfig` reads it only for providers that use one, so a base URL cannot follow the user across a provider switch and receive the wrong key.

`onSettingsChange` keeps popup and options in sync; without it, whichever saved last silently reverted the other.

## Styling

`src/styles/tokens.css` defines everything in oklch, for `:root` and `:host` so the same tokens apply inside the shadow root. `data-theme="light"` switches the palette; `resolveTheme` in `src/shared/theme.ts` resolves the stored setting, following the OS preference when it is `system`.
