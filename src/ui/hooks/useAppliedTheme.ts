/**
 * Applies the resolved theme to the document root.
 *
 * Keeps `data-theme` in sync with the stored setting and, when that is
 * 'system', with the OS preference.
 */

import { useEffect } from 'react';
import { onSystemThemeChange, resolveTheme } from '@/shared/theme';
import type { ThemeOption } from '@/shared/types';

export function useAppliedTheme(theme: ThemeOption): void {
  useEffect(() => {
    const apply = (value: 'light' | 'dark') =>
      document.documentElement.setAttribute('data-theme', value);

    apply(resolveTheme(theme));

    if (theme !== 'system') return;
    return onSystemThemeChange(apply);
  }, [theme]);
}
