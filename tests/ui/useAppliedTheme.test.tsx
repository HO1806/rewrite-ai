/**
 * The theme hook, which both the popup and the options page depend on.
 *
 * Its only assertion lived in a popup test that was deleted along with the Info
 * and Playground tabs — collateral of a trim that had nothing to do with
 * theming. Nothing has checked `data-theme` since, though the feature is live on
 * both surfaces.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useAppliedTheme } from '@/ui/hooks/useAppliedTheme';
import type { ThemeOption } from '@/shared/types';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
});

function Harness({ theme }: { theme: ThemeOption }) {
  useAppliedTheme(theme);
  return null;
}

/** jsdom has no matchMedia; the hook reads it through resolveTheme. */
function stubSystemPreference(prefersDark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: prefersDark,
      addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) =>
        listeners.add(fn),
      removeEventListener: (
        _: string,
        fn: (event: MediaQueryListEvent) => void,
      ) => listeners.delete(fn),
    })),
  );

  return (nowPrefersDark: boolean) => {
    for (const fn of listeners) {
      fn({ matches: nowPrefersDark } as MediaQueryListEvent);
    }
  };
}

describe('useAppliedTheme', () => {
  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
  ] as Array<[ThemeOption, string]>)(
    'applies an explicit %s choice to the document',
    (theme, expected) => {
      render(<Harness theme={theme} />);

      expect(document.documentElement.getAttribute('data-theme')).toBe(
        expected,
      );
    },
  );

  it('resolves system to the OS preference', () => {
    stubSystemPreference(true);
    render(<Harness theme="system" />);

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  /** The subscription is the half most likely to rot, since nothing calls it. */
  it('follows the OS preference while set to system', () => {
    const changePreference = stubSystemPreference(true);
    render(<Harness theme="system" />);

    changePreference(false);

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('ignores the OS preference once a theme is chosen explicitly', () => {
    const changePreference = stubSystemPreference(true);
    render(<Harness theme="light" />);

    changePreference(true);

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
