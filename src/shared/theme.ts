/**
 * Theme resolution.
 *
 * The stored `theme` setting was persisted and validated but read nowhere, while
 * each surface hardcoded its own palette. Now every surface resolves it here and
 * sets `data-theme`, which the token stylesheet keys off.
 */

import type { ThemeOption } from './types';

export type ResolvedTheme = 'light' | 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function resolveTheme(theme: ThemeOption): ResolvedTheme {
  if (theme === 'light' || theme === 'dark') return theme;
  return prefersDark() ? 'dark' : 'light';
}

function prefersDark(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia(DARK_QUERY).matches
  );
}

/**
 * Watch the OS preference.
 * Returns an unsubscribe function; only fires while the setting is 'system'.
 */
export function onSystemThemeChange(
  callback: (theme: ResolvedTheme) => void,
): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};

  const query = window.matchMedia(DARK_QUERY);
  const listener = (event: MediaQueryListEvent) =>
    callback(event.matches ? 'dark' : 'light');

  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
