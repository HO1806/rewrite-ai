/**
 * Card mount lifecycle.
 *
 * The React root and the DOM node it renders into are stored together and
 * always created and discarded as a pair. Previously the root was cached in a
 * module global while the mount point was looked up fresh on every call, so if
 * the host element was removed by anything other than the card's own close
 * handler — an SPA route change, a host-page sanitizer — the next invocation
 * built a new host but rendered into the old detached node. The card silently
 * stopped appearing for the rest of the page's life.
 */

import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createShadowContainer, removeShadowContainer } from './shadow';

interface ActiveMount {
  root: Root;
  host: HTMLElement;
}

let active: ActiveMount | null = null;

/** Render into a fresh container, replacing any existing card. */
export function mountCard(render: (close: () => void) => ReactNode): void {
  unmountCard();

  const { host, mountPoint } = createShadowContainer();
  const root = createRoot(mountPoint);
  active = { root, host };

  root.render(render(unmountCard));
}

export function unmountCard(): void {
  if (!active) {
    // Clear any host left behind by a previous page state.
    removeShadowContainer();
    return;
  }

  const { root, host } = active;
  active = null;

  // Unmounting synchronously from inside a React event handler warns, so the
  // teardown is deferred to a microtask.
  queueMicrotask(() => {
    root.unmount();
    host.remove();
  });
}

/** Test seam: whether a card is currently mounted. */
export function isCardMounted(): boolean {
  return active !== null;
}

/** Propagate the user's theme choice to the shadow root. */
export function applyCardTheme(theme: 'light' | 'dark'): void {
  active?.host.setAttribute('data-theme', theme);
}
