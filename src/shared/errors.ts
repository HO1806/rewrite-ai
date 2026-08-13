/**
 * Error narrowing helpers.
 *
 * A thrown value is `unknown` in TypeScript and can genuinely be anything —
 * a string, a DOMException, a rejected non-Error. Reading `.message` off it
 * directly yields `undefined` and surfaces "undefined" to the user, so every
 * catch block funnels through here instead.
 */

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unexpected error';
}

/** True when a caught value is the DOMException produced by an aborted fetch. */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
