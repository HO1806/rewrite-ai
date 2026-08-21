/**
 * The streaming-port client.
 *
 * One implementation shared by the floating card and the popup playground. They
 * previously each hand-rolled the protocol, and the popup's copy kept no
 * reference to its port and never disconnected — so pressing "Test" twice
 * interleaved two streams character-by-character into a single string.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { STREAM_PORT_NAME } from '@/shared/constants';
import type {
  RewriteAction,
  StreamMessage,
  StreamRequest,
} from '@/shared/types';
import { getErrorMessage } from '@/shared/errors';

export interface StreamState {
  text: string;
  isGenerating: boolean;
  error: string | null;
}

export interface StartOptions {
  action: RewriteAction;
  text: string;
}

const IDLE: StreamState = { text: '', isGenerating: false, error: null };

export function useStreamingRewrite(): StreamState & {
  start: (options: StartOptions) => void;
  reset: () => void;
} {
  const [state, setState] = useState<StreamState>(IDLE);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const isMountedRef = useRef(true);

  const disconnect = useCallback(() => {
    portRef.current?.disconnect();
    portRef.current = null;
  }, []);

  const start = useCallback(
    ({ action, text }: StartOptions) => {
      // Supersede any request already in flight.
      disconnect();
      setState({ text: '', isGenerating: true, error: null });

      // Guards against a late message from a port we have already replaced.
      const update = (apply: (previous: StreamState) => StreamState) => {
        if (isMountedRef.current) setState(apply);
      };

      try {
        const port = chrome.runtime.connect({ name: STREAM_PORT_NAME });
        portRef.current = port;

        port.onMessage.addListener((message: StreamMessage) => {
          if (portRef.current !== port) return;

          switch (message.type) {
            case 'CHUNK':
              update((previous) => ({
                ...previous,
                text: previous.text + message.text,
              }));
              break;
            case 'DONE':
              update(() => ({
                text: message.fullText,
                isGenerating: false,
                error: null,
              }));
              portRef.current = null;
              break;
            case 'ERROR':
              update((previous) => ({
                ...previous,
                isGenerating: false,
                error: message.message,
              }));
              portRef.current = null;
              break;
          }
        });

        /**
         * If the service worker is evicted mid-stream the port closes without a
         * DONE or ERROR. Without this the UI would stay "Generating…" forever.
         */
        port.onDisconnect.addListener(() => {
          if (portRef.current !== port) return;
          portRef.current = null;
          update((previous) =>
            previous.isGenerating
              ? {
                  ...previous,
                  isGenerating: false,
                  error:
                    'The connection closed before the rewrite finished. Try again.',
                }
              : previous,
          );
        });

        const request: StreamRequest = { type: 'START_REWRITE', action, text };
        port.postMessage(request);
      } catch (err: unknown) {
        portRef.current = null;
        update((previous) => ({
          ...previous,
          isGenerating: false,
          error: getErrorMessage(err),
        }));
      }
    },
    [disconnect],
  );

  const reset = useCallback(() => {
    disconnect();
    setState(IDLE);
  }, [disconnect]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      disconnect();
    };
  }, [disconnect]);

  return { ...state, start, reset };
}
