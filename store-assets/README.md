# Store assets

Chrome Web Store listing images. **Nothing here ships inside the extension** — it
lives outside the build so it cannot be bundled or exposed to pages, which is
what previously happened via `web_accessible_resources`.

```
upload/   the assets to upload, at exactly the required dimensions — tracked in git
source/   the oversized originals they were built from — gitignored (~12.6 MB)
```

## Rebuilding

```bash
pip install Pillow
python scripts/build_store_assets.py
```

The script is idempotent and also regenerates `icons/icon-{16,48,128}.png`, since
the toolbar mark comes from the same artwork as the store icon. Every asset goes
through one cover-crop-then-Lanczos path, so nothing is ever stretched to fit or
padded out with bars.

## What is in `upload/`

| File | Size | Purpose |
| ---- | ---- | ------- |
| `screenshot-1-hero.png` | 1280×800 | Headline shot |
| `screenshot-2-whatsapp-tone.png` | 1280×800 | Card + Adjust drawer, Tone tab |
| `screenshot-3-gmail-format.png` | 1280×800 | Gmail compose, Format tab |
| `screenshot-4-context-menu.png` | 1280×800 | Right-click entry point |
| `screenshot-5-popup-settings.png` | 1280×800 | Provider configuration |
| `alt-whatsapp-simple.png` | 1280×800 | Spare — card without the drawer |
| `alt-context-menu-dark.png` | 1280×800 | Spare — dark-theme context menu |
| `promo-small-440x280.png` | 440×280 | Small promotional tile |
| `store-icon-128.png` | 128×128 | Store icon, artwork at 96×96 with 16px padding |

Upload screenshots 1–5; the store accepts a **maximum of five**, so the two
`alt-` files are there to swap in. No 1400×560 marquee tile is built: it is
optional, and no source is anywhere near 2.5∶1, so producing one would mean
cutting ~37% of the height off a composition built for 1.57∶1.

Requirements are per
[developer.chrome.com/docs/webstore/images](https://developer.chrome.com/docs/webstore/images).

## ⚠️ The screenshots do not match the current UI

They were generated before the code was reworked, and they show things that no
longer exist. Web Store review requires screenshots to represent the extension
accurately, so **these are a rejection risk regardless of their dimensions**:

- **Tone pills** read `Informational` / `Funny`. The code now offers Professional,
  Casual, Enthusiastic, Informal, Neutral, Funny — the pill labelled "Funny" used
  to request a *neutral* tone, which was a bug that has since been fixed.
- **Format pills** read `Paragraph, Bullets, Email, Formal Letter, Summary, List`.
  `FORMAT_OPTIONS` has four: Paragraph, Email, Ideas, Blog post.
- **Groq model presets** read `mixtral-8x7b`, `gemma2-9b`, `qwen2.5-72b`, and the
  popup shows a `v1.2.0` badge and a "Rate us" link. None of those exist.
- The popup's whole layout has since been rebuilt on the shared settings form.

The durable fix is real screenshots of the built extension: `pnpm build`, load
`dist/` unpacked, and capture the popup, the floating card mid-stream, the adjust
drawer and the options page at 1280×800. See `.claude/commands/build-extension.md`
for the walkthrough. Drop them into `source/` and the script will size them.

`asset-prompts.txt` holds the original generation prompts, kept as provenance.
