/**
 * Answers "what models can this key actually use?" for the options page.
 *
 * The extension used to answer that from a hardcoded list in
 * `shared/constants.ts`, which is a dated assertion rather than a fact: Groq
 * retired both of its entries two months after announcing them, and the first
 * the user knew of it was a 404 in the middle of a rewrite. The provider knows;
 * this asks it.
 *
 * The fetch happens here, in the worker, for the same reason every other
 * provider call does — it is the process that is allowed to hold a key and the
 * one with host permissions.
 */

import { buildProviderConfig, createProvider } from '@/ai/factory';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import { settingsSchema } from '@/storage/settings';
import { toUserMessage } from './streamHandler';
import { listModelsRequestSchema } from './messages';

/** Listing needs four fields; the rest only exist to satisfy the schema. */
function configFrom(
  draft: ReturnType<typeof listModelsRequestSchema.parse>['settings'],
) {
  return buildProviderConfig(
    settingsSchema.parse({ ...DEFAULT_SETTINGS, ...draft }),
  );
}

export function registerModelsBridge(): void {
  chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
    const parsed = listModelsRequestSchema.safeParse(raw);
    if (!parsed.success) return undefined;

    /**
     * Started inside the promise chain on purpose. `configFrom` parses, and
     * `buildProviderConfig` throws for a custom provider with no base URL — both
     * synchronously. Called before the chain, either throw escaped the listener
     * entirely: `return true` never ran, `sendResponse` never fired, and the
     * options page saw a closed channel instead of the message the factory had
     * gone to the trouble of writing.
     */
    Promise.resolve()
      .then(() => createProvider(configFrom(parsed.data.settings)).listModels())
      .then((models) => sendResponse({ ok: true, models }))
      .catch((err: unknown) =>
        // Reported, never swallowed: a silent empty list would look identical to
        // a provider that genuinely offers nothing.
        sendResponse({
          ok: false,
          message: toUserMessage(err) ?? 'Could not load models.',
        }),
      );

    // Replying asynchronously, so the channel has to stay open.
    return true;
  });
}
