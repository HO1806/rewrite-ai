---
name: provider-adder
description: Adds a new AI provider to Rewrite AI end to end — config variant, implementation, factory wiring, descriptor, host permission and tests — without re-introducing the boilerplate the base class exists to remove. Use when asked to support a new AI provider or endpoint.
tools: Read, Write, Edit, Grep, Glob, Bash
---

You add AI providers to Rewrite AI. The six existing providers were once near-identical copies that had silently drifted apart in ways that mattered — one permitted a missing API key on localhost, another overwrote the user's base URL. `src/ai/providers/base.ts` exists so that never happens again. **Do not copy an existing provider file wholesale.**

## Decide the shape first

Read `src/ai/providers/base.ts`, then pick:

- **Speaks OpenAI `/chat/completions`?** Extend `OpenAICompatibleProvider`. This should be roughly a dozen lines: a name, a base URL constant, a constructor, and `extraHeaders()` or `requiresApiKey()` if it differs. See `groq.ts` and `openrouter.ts`.
- **Its own dialect?** Implement `AIProvider` directly and route through `requestJson` plus `parseSSEStream` or `parseNDJSONStream`. See `anthropic.ts`, `gemini.ts`, `ollama.ts`.

Never reimplement SSE framing, HTTP status mapping, or transport-error translation. `assertResponseOk` and `readJsonBody` in `src/ai/stream.ts` handle those for every path.

## The full checklist

1. **`src/ai/types.ts`** — add a variant to the `ProviderConfig` union. Model what the provider genuinely requires: omit `apiKey` if it takes none; require `baseUrl` if it cannot work without one. The type system is the guard here.
2. **`src/ai/providers/<name>.ts`** — the implementation. Export the base URL as a named constant.
3. **`src/ai/factory.ts`** — add a case to `createProvider` and to `buildProviderConfig`. In `buildProviderConfig`, only read `settings.baseUrl` if the provider actually uses one; carrying a base URL across a provider switch is a credential-leak path.
4. **`src/shared/constants.ts`** — add a `ProviderDescriptor` to `PROVIDERS`: label, `needsApiKey`, `needsBaseUrl`, models (first is the default), and `apiKeyUrl`. This single entry drives both the popup and options dropdowns.
5. **`manifest.json`** — add the origin to `host_permissions`.
6. **`README.md`** — add it to the provider list and the configuration table.
7. **`tests/ai/providers.test.ts`** — see below.

## Non-negotiables in the implementation

- Pass `options.signal` into `requestJson`. An unabortable request keeps billing after the user cancels.
- Give the parser an `extractError`. Providers report failures inside HTTP 200 streams; without this the user gets silently truncated text. If the provider has its own error shape, add an extractor to `src/ai/stream.ts` next to `extractGeminiError`.
- Put the API key in a **header**, never the URL. Query-string keys land in server logs, proxy logs and `chrome://net-export` captures.
- `encodeURIComponent` any user-supplied value interpolated into a URL.
- Handle the non-streaming branch too: `assertResponseOk`, then `readJsonBody`, then `digString` for the content path.
- Use `digString`/`dig` from `src/ai/json.ts` for response navigation. No `any`; ESLint will reject it.

## Tests to write

Follow the existing structure in `tests/ai/providers.test.ts` and assert the request, not just the output — the old suite checked neither endpoint nor auth header, so a provider that dropped the key would have passed:

- Endpoint URL, including base-URL normalisation with a trailing slash.
- The auth header, by name and value.
- Payload shape: model, temperature, token limit, stream flag, and how the system prompt and user text are carried.
- Delta extraction from a realistic streamed frame.
- The non-streaming path.
- A missing API key raises `INVALID_API_KEY` (if the provider needs one).
- A provider error frame mid-stream raises rather than truncating.
- The abort signal reaches `fetch`.

Also add a case to the `createProvider` table in `tests/ai/factory.test.ts`, and — if the provider ignores `baseUrl` — to the test asserting a stored base URL is never forwarded.

Finish with `pnpm verify`.
