---
description: Build the extension and walk through loading and manually verifying it in Chrome.
---

## Build

```bash
pnpm build
```

Then sanity-check the output before touching the browser:

```bash
ls dist/ dist/assets/
cat dist/manifest.json
```

Confirm:

- **CSS is present** in `dist/assets/`. Zero emitted CSS means the token stylesheets are not reaching the build — that was a real regression once, when Tailwind was configured but no stylesheet was ever imported.
- **No store screenshots** in `dist/assets/`. Those live in `store-assets/` and must stay out of the bundle; they are 12.6 MB and were once exposed to every page.
- The built `manifest.json` carries the expected `host_permissions`, `content_scripts.all_frames`, and version.

## Load

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. **Load unpacked** → select `dist/`.
4. Open the service-worker console via the **service worker** link on the extension card. It should be free of errors.
5. Click **service worker** → **Stop**, then trigger the extension again. This proves the `onStartup` registration path works and that nothing assumed worker state survives.

## Manual checks

These are the paths tests cannot fully cover. Report which you actually ran and what you observed — do not claim a check you did not perform.

- **Textarea on a page scrolled ~2000px down** → the card appears next to the selection, not off-screen.
- **`<input type="text">`** → Replace changes the value, and `Ctrl+Z` undoes it.
- **Contenteditable** (a Gmail draft) → Replace works, and `Ctrl+Enter` does **not** also send the message.
- **Inside an iframe** → the card appears near the selection, not pinned to a corner.
- **Read-only page text** → the button reports "Copied instead", and the card stays open.
- **Click an Adjust pill mid-stream** → the previous request cancels, no unhandled rejection in the worker console, and only one stream's text appears. Check the Network panel to confirm the abandoned request is actually aborted, not merely ignored.
- **"Funny" tone** → inspect the request payload; the system prompt must ask for humour.
- **A bad API key**, with streaming both on and off → both report "Invalid API key".
- **Delete `<div id="rewrite-ai-root">` via devtools**, then trigger again → the card still renders.
- **A base URL under `custom`, then switch to OpenAI in the popup** → the base URL clears, and the Network panel shows the request going to `api.openai.com`.
- **Keyboard only** → focus enters the card on open, Tab is trapped inside it, Escape closes it and focus returns to where you were typing.
- **No request carries the key in a URL** — check the Network panel, especially for Gemini.
