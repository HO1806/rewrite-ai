/**
 * In-page surface lifecycle.
 *
 * One surface now — the floating `card`. There were two until the inline trigger
 * was removed, and the registry shape is kept because the reason for it has not
 * changed: a surface keeps its React root and the DOM node it renders into
 * together, and always creates and discards them as a pair. Previously a root was cached in a module global while the mount point was
 * looked up fresh on every call, so if the host element was removed by anything
 * other than the close handler — an SPA route change, a host-page sanitizer — the
 * next invocation built a new host but rendered into the old detached node, and
 * the card silently stopped appearing for the rest of the page's life.
 */

import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SHADOW_HOST_ID } from '@/shared/constants';
import { createShadowContainer, removeShadowContainer } from './shadow';

export type SurfaceName = 'card';

const HOST_IDS: Record<SurfaceName, string> = { card: SHADOW_HOST_ID };

interface ActiveMount {
  root: Root;
  host: HTMLElement;
}

const active = new Map<SurfaceName, ActiveMount>();

/** Render a surface into a fresh container, replacing any existing one. */
export function mountSurface(
  name: SurfaceName,
  render: (close: () => void) => ReactNode,
): void {
  unmountSurface(name);

  const { host, mountPoint } = createShadowContainer(HOST_IDS[name]);
  const root = createRoot(mountPoint);
  active.set(name, { root, host });

  root.render(render(() => unmountSurface(name)));
}

export function unmountSurface(name: SurfaceName): void {
  const mounted = active.get(name);

  if (!mounted) {
    // Clear any host left behind by a previous page state.
    removeShadowContainer(HOST_IDS[name]);
    return;
  }

  active.delete(name);

  // Unmounting synchronously from inside a React event handler warns, so the
  // teardown is deferred to a microtask.
  queueMicrotask(() => {
    mounted.root.unmount();
    mounted.host.remove();
  });
}

export function isSurfaceMounted(name: SurfaceName): boolean {
  return active.has(name);
}

/** Propagate the user's theme choice to a surface's shadow root. */
export function applySurfaceTheme(
  name: SurfaceName,
  theme: 'light' | 'dark',
): void {
  active.get(name)?.host.setAttribute('data-theme', theme);
}
