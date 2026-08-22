/**
 * Streaming port handler.
 *
 * One StreamSession per connected port. The session owns an AbortController so
 * that a disconnect or a timeout actually stops the in-flight provider request.
 *
 * The previous implementation registered no `onDisconnect` handler at all, while
 * the card disconnects its port on every Adjust-pill click, Regenerate and
 * unmount. The still-running loop would then post a chunk to a dead port, throw,
 * and the catch block would post the error to that same dead port and throw
 * again — inside an async listener with no outer catch, producing an unhandled
 * rejection in the service worker and leaving the abandoned generation billing.
 */

import {
  ABORT_CANCELLED,
  ABORT_TIMEOUT,
  AIProviderError,
  abortErrorFor,
} from '@/ai/types';
import { buildProviderConfig, createProvider } from '@/ai/factory';
import { assemblePrompt, sanitizeResult } from '@/prompts';
import { Settings, loadSettings, updateSettings } from '@/storage/settings';
import {
  REQUEST_TIMEOUT_MS,
  REQUEST_TIMEOUT_NO_STREAM_MS,
  STREAM_PORT_NAME,
  getProvider,
} from '@/shared/constants';
import type { StreamMessage } from '@/shared/types';
import { getErrorMessage } from '@/shared/errors';
import { describeValidationError, streamRequestSchema } from './messages';

export function registerStreamHandler(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== STREAM_PORT_NAME) return;
    new StreamSession(port).listen();
  });
}

class StreamSession {
  private isConnected = true;
  private controller: AbortController | null = null;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly port: chrome.runtime.Port) {}

  listen(): void {
    this.port.onDisconnect.addListener(() => {
      this.isConnected = false;
      this.cancel(ABORT_CANCELLED);
    });

    this.port.onMessage.addListener((raw: unknown) => {
      void this.handleMessage(raw);
    });
  }

  private async handleMessage(raw: unknown): Promise<void> {
    const parsed = streamRequestSchema.safeParse(raw);
    if (!parsed.success) {
      // Anything that isn't a valid START_REWRITE is rejected here rather than
      // reaching a provider.
      this.post({
        type: 'ERROR',
        message: describeValidationError(parsed.error),
      });
      return;
    }

    // A second request on the same port supersedes the first.
    this.cancel(ABORT_CANCELLED);

    const controller = new AbortController();
    this.controller = controller;

    try {
      const settings = await loadSettings();

      // A non-streamed request produces no port traffic, so nothing resets the
      // worker's idle timer and a 90s timeout could never fire — the worker
      // would be evicted first and the client would only see the port close.
      this.timeoutHandle = setTimeout(
        () => controller.abort(ABORT_TIMEOUT),
        settings.stream ? REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_NO_STREAM_MS,
      );

      await this.run(parsed.data, controller.signal, settings);
    } catch (err: unknown) {
      const message = toUserMessage(err);
      if (message) this.post({ type: 'ERROR', message });
    } finally {
      if (this.controller === controller) {
        this.clearTimeout();
        this.controller = null;
      }
    }
  }

  private async run(
    request: ReturnType<typeof streamRequestSchema.parse>,
    signal: AbortSignal,
    settings: Settings,
  ): Promise<void> {
    /**
     * Checked before anything is built or sent.
     *
     * Without a key the old path still opened the card, showed a spinner, made a
     * request that was never going to be answered, and only then reported the
     * provider's own wording. On first run that is the entire experience of the
     * extension, and it says nothing about what to do next.
     */
    if (getProvider(settings.provider).needsApiKey && !settings.apiKey.trim()) {
      throw new AIProviderError(
        `No ${getProvider(settings.provider).label} API key yet. Open the extension options and add one.`,
        'MISSING_API_KEY',
      );
    }

    const provider = createProvider(buildProviderConfig(settings));

    /**
     * The only place a prompt is built and the only caller of `provider.rewrite`,
     * which is why framing the selection here reaches all seven providers without
     * touching one of them.
     */
    const prompt = assemblePrompt(request.action, request.text, {
      language: settings.translateLanguage,
    });

    /**
     * Remember which tab the card was on, so the shortcut reopens there.
     *
     * Recorded here rather than through a message of its own: switching tabs in
     * the card re-runs the rewrite, so every switch already passes through this
     * point. A failure to persist must not abort the rewrite the user asked for.
     */
    if (settings.lastAction !== request.action) {
      // Awaited, not fired and forgotten: the next press of the shortcut reads
      // this back, and a write still in flight would reopen the previous tab.
      // A failure to persist must not fail the rewrite the user asked for.
      await updateSettings({ lastAction: request.action }).catch(() => {});
    }

    /**
     * Truncation is reported, not thrown. The text produced before the limit is
     * real and usually most of the rewrite, so discarding it to raise an error
     * would cost the user more than the warning gains them.
     */
    let wasTruncated = false;

    const generator = provider.rewrite(prompt.user, prompt.system, {
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      stream: settings.stream,
      signal,
      onTruncated: () => {
        wasTruncated = true;
      },
    });

    let fullText = '';
    for await (const chunk of generator) {
      // Stop pulling from the provider once nobody is listening.
      if (!this.isConnected) throw abortErrorFor(signal);

      fullText += chunk;
      this.post({ type: 'CHUNK', text: chunk });
    }

    if (signal.aborted) throw abortErrorFor(signal);

    /**
     * Cleaned once, here at the boundary, so every consumer sees the same string:
     * the card displays it, and `replace.ts` compares it against the captured
     * selection to tell a real substitution from an append.
     *
     * CHUNKs stay raw — the card replaces its streamed text with `fullText` on
     * DONE, so an echoed delimiter corrects itself rather than needing a
     * stateful prefix guard mid-stream.
     */
    const cleaned = sanitizeResult(fullText, prompt);

    // An empty completion is a failure, not a success. Reporting DONE with an
    // empty string cleared the card's spinner and left a blank box behind.
    if (!cleaned.trim()) {
      throw new AIProviderError(
        'The model returned an empty response. Try again, or adjust the model settings.',
        'EMPTY_RESPONSE',
      );
    }

    this.post({
      type: 'DONE',
      fullText: cleaned,
      ...(wasTruncated ? { truncated: true } : {}),
    });
  }

  /** Abort the in-flight request, if any. */
  private cancel(reason: string): void {
    this.controller?.abort(reason);
    this.controller = null;
    this.clearTimeout();
  }

  private clearTimeout(): void {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  /** Post to the port, but never to one that has already gone away. */
  private post(message: StreamMessage): void {
    if (!this.isConnected) return;

    try {
      this.port.postMessage(message);
    } catch {
      // The port closed between the check and the send; the consumer is gone.
      this.isConnected = false;
    }
  }
}

/**
 * Turn a thrown value into something worth showing the user.
 * Returns null when the failure should stay silent (the user cancelled).
 */
export function toUserMessage(err: unknown): string | null {
  if (!(err instanceof AIProviderError)) {
    return getErrorMessage(err);
  }

  switch (err.code) {
    case 'CANCELLED':
      return null;
    case 'INVALID_API_KEY':
      return 'Invalid API key. Check your key in the extension options.';
    // Carries its own wording: it names the provider and says what to do, which
    // on first run is the only thing the user needs to hear.
    case 'MISSING_API_KEY':
      return err.message;
    case 'RATE_LIMIT':
      return 'Rate limit reached. Wait a moment and try again.';
    case 'TIMEOUT':
      return 'The request timed out. Try again, or reduce the amount of selected text.';
    case 'NETWORK_ERROR':
      return `Could not reach the provider. Check your connection. (${err.message})`;
    case 'OFFLINE':
    case 'EMPTY_RESPONSE':
    case 'STREAM_ERROR':
      return err.message;
    case 'PROVIDER_ERROR':
      /**
       * A retired model is the one provider error a user can fix themselves, and
       * the provider's own wording ("does not exist or you do not have access")
       * does not say how. Providers retire models on their own schedule — Groq
       * killed two of this extension's defaults with two months' notice — so this
       * points at the button that lists what the key can actually use.
       */
      return isModelUnavailable(err)
        ? `${err.message} Open the extension options and choose another model — "Load models" lists the ones your key can use.`
        : err.message;
    default:
      return err.message;
  }
}

/**
 * A model this key cannot use, as opposed to a wrong key (401), a dead host, or
 * a model that exists but is busy.
 *
 * Status first: every provider here answers 404 for an unknown model. The text
 * backstop deliberately matches not-found wording rather than the word "model" —
 * that looser check told a user facing "model overloaded", a capacity error, to
 * go and pick a different model, which an existing test caught.
 */
function isModelUnavailable(err: AIProviderError): boolean {
  if (err.statusCode === 404) return true;

  const message = err.message.toLowerCase();
  return message.includes('does not exist') || message.includes('not found');
}
