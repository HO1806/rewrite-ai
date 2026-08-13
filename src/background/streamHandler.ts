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
import { getPromptForAction } from '@/prompts';
import { loadSettings } from '@/storage/settings';
import { REQUEST_TIMEOUT_MS, STREAM_PORT_NAME } from '@/shared/constants';
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
    this.timeoutHandle = setTimeout(
      () => controller.abort(ABORT_TIMEOUT),
      REQUEST_TIMEOUT_MS,
    );

    try {
      await this.run(parsed.data, controller.signal);
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
  ): Promise<void> {
    const settings = await loadSettings();
    const provider = createProvider(buildProviderConfig(settings));

    const systemPrompt = getPromptForAction(request.action, {
      language: settings.translateLanguage,
      ...request.adjustParams,
    });

    const generator = provider.rewrite(request.text, systemPrompt, {
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      stream: settings.stream,
      signal,
    });

    let fullText = '';
    for await (const chunk of generator) {
      // Stop pulling from the provider once nobody is listening.
      if (!this.isConnected) throw abortErrorFor(signal);

      fullText += chunk;
      this.post({ type: 'CHUNK', text: chunk });
    }

    if (signal.aborted) throw abortErrorFor(signal);

    // An empty completion is a failure, not a success. Reporting DONE with an
    // empty string cleared the card's spinner and left a blank box behind.
    if (!fullText.trim()) {
      throw new AIProviderError(
        'The model returned an empty response. Try again, or adjust the model settings.',
        'EMPTY_RESPONSE',
      );
    }

    this.post({ type: 'DONE', fullText });
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
    case 'RATE_LIMIT':
      return 'Rate limit reached. Wait a moment and try again.';
    case 'TIMEOUT':
      return 'The request timed out. Try again, or reduce the amount of selected text.';
    case 'NETWORK_ERROR':
      return `Could not reach the provider. Check your connection. (${err.message})`;
    case 'OFFLINE':
    case 'EMPTY_RESPONSE':
    case 'STREAM_ERROR':
    case 'PROVIDER_ERROR':
      return err.message;
    default:
      return err.message;
  }
}
