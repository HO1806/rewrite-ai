# Store assets

Chrome Web Store listing images. **Nothing here ships inside the extension** — it
lives outside the build so it cannot be bundled or exposed to pages, which is
what previously happened via `web_accessible_resources`.

The generated PNGs are gitignored: they are ~12.6 MB in total, and none of them
currently meet the store's requirements, so committing them would bloat history
with files that need replacing anyway. They remain on disk locally.

`asset-prompts.txt` **is** tracked, since it is the reproducible source.

## What needs regenerating

| Needed              | Purpose             | Current state                       |
| ------------------- | ------------------- | ----------------------------------- |
| 1280 × 800 (×5)     | Listing screenshots | Have 1586 × 992 and 1573 × 1000     |
| 512 × 512           | Store icon          | Have 1024 × 1024                    |
| 440 × 280           | Small promo tile    | Never produced                      |

The existing images also predate the UI rewrite, so they no longer show the
current interface. These should be real screenshots of the built extension rather
than generated images — build with `pnpm build`, load `dist/`, and capture the
popup, the floating card mid-stream, the adjust drawer, and the options page.
