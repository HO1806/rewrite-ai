/**
 * The theme, fetched without touching settings storage.
 *
 * The content script runs in a process shared with the page, so it must not read
 * the settings object — that holds the API key. It asks the worker for the one
 * field it needs and resolves `'system'` itself, since that requires
 * `window.matchMedia`.
 */

import { themeResponseSchema } from '@/background/messages';
import { resolveTheme } from '@/shared/theme';
import type { ResolvedTheme } from '@/shared/theme';

export async function loadResolvedTheme(): Promise<ResolvedTheme> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_THEME' });
    const parsed = themeResponseSchema.safeParse(response);
    return resolveTheme(parsed.success ? parsed.data.theme : 'system');
  } catch {
    // The worker may be starting up, or the page may have been torn down.
    return 'dark';
  }
}
