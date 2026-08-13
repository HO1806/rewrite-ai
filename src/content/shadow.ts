/**
 * Shadow DOM container for the floating card.
 *
 * The card renders inside a shadow root so the host page's styles cannot reach
 * it and its own styles cannot leak out.
 */

import { SHADOW_HOST_ID } from '@/shared/constants';
import tokensCss from '@/styles/tokens.css?inline';
import cardCss from '@/styles/card.css?inline';

const MOUNT_ID = 'rewrite-ai-mount';

export interface ShadowContainer {
  host: HTMLElement;
  shadowRoot: ShadowRoot;
  mountPoint: HTMLDivElement;
}

/**
 * Build a fresh container.
 *
 * Always creates a new host rather than reusing one found in the document: the
 * caller pairs the returned mount point with a React root, and reusing a host
 * whose root has been discarded is what previously left the card permanently
 * invisible after the host page removed the element.
 */
export function createShadowContainer(): ShadowContainer {
  removeShadowContainer();

  const host = document.createElement('div');
  host.id = SHADOW_HOST_ID;
  // The host itself occupies no space; the card inside is position: fixed.
  host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;';

  document.body.appendChild(host);

  const shadowRoot = host.attachShadow({ mode: 'open' });
  shadowRoot.appendChild(createStyleSheet());

  const mountPoint = document.createElement('div');
  mountPoint.id = MOUNT_ID;
  shadowRoot.appendChild(mountPoint);

  return { host, shadowRoot, mountPoint };
}

/**
 * The tokens and card stylesheets, inlined at build time.
 *
 * `?inline` is the wiring the project always intended — the module declaration
 * for it existed in vite-env.d.ts but nothing ever used it, so the stylesheet
 * sat unimported and a hand-written subset was injected as a string instead.
 */
function createStyleSheet(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
      font-family: var(--font-sans);
    }
    ${tokensCss}
    ${cardCss}
  `;
  return style;
}

export function removeShadowContainer(): void {
  document.getElementById(SHADOW_HOST_ID)?.remove();
}
