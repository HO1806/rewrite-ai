# Contributing

Thanks for helping out. This is a Chrome MV3 extension built with TypeScript, React, Vite and `@crxjs/vite-plugin`.

## Getting set up

```bash
pnpm install
pnpm dev
```

Requires Node >= 20 and pnpm >= 9. The lockfile is v9; pnpm 8 cannot read it.

## Before opening a pull request

```bash
pnpm verify
```

That runs typecheck, lint, format check, tests with coverage thresholds, and the production build. All of it must pass.

## Conventions

- **Immutability.** Return new objects; do not mutate arguments.
- **No `any`.** Use `unknown` for anything crossing a boundary and narrow it. The helpers in `src/ai/json.ts` exist for navigating provider responses.
- **Validate at boundaries with Zod.** Every message crossing a process boundary is validated in `src/background/messages.ts`, and settings in `src/storage/settings.ts`. Adding a message type means adding a schema for it.
- **Handle errors explicitly.** No empty catch blocks. If a fallback changes what the user gets, say so in the UI rather than reporting success.
- **One definition per fact.** Provider labels, models and action titles live in `src/shared/constants.ts`. If you find yourself writing a second copy, export the first.
- **Style with tokens.** Colours, spacing, radii and durations come from `src/styles/tokens.css`. No hardcoded hex values in components.
- **Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`.

## Testing

- New code needs tests. Coverage thresholds are enforced at 80% and the suite currently sits well above that.
- Tests live in `tests/`, mirroring `src/`.
- `tests/chromeMock.ts` provides the Chrome API double, including connected port pairs for exercising the streaming protocol end to end. Prefer driving the real modules across a port over mocking them out.
- Name tests for the behaviour under test, and note the bug when a test guards a specific regression.

## Adding an AI provider

1. Add a variant to `ProviderConfig` in `src/ai/types.ts`.
2. If it speaks the OpenAI `/chat/completions` dialect, extend `OpenAICompatibleProvider` in `src/ai/providers/base.ts` — usually a dozen lines. Otherwise implement `AIProvider` directly and route the response through `parseSSEStream` or `parseNDJSONStream`.
3. Register it in `createProvider` and `buildProviderConfig` in `src/ai/factory.ts`.
4. Add a descriptor to `PROVIDERS` in `src/shared/constants.ts`.
5. Add its origin to `host_permissions` in `manifest.json`.
6. Add tests asserting the endpoint, the auth header, the payload shape and the delta extraction.

Pass the abort signal to `fetch` and give the parser an `extractError` so failures reported inside a 200 response surface instead of truncating the output.

## MV3 gotchas worth knowing

- The service worker is terminated when idle. Never assume state survives between events.
- Never hardcode a bundler output path; read it from `chrome.runtime.getManifest()`.
- The API key belongs in the service worker. Do not read settings from the content script.
- The floating card is `position: fixed`, so its coordinates are viewport-relative — no scroll offsets.
- `chrome.runtime.lastError` must be checked after callback-style APIs, or failures are invisible.
