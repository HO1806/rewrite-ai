/**
 * Shadow DOM containers for the extension's in-page surfaces.
 *
 * Each surface — the floating card, the inline trigger button — gets its own
 * host and its own shadow root, so the host page's styles cannot reach them and
 * theirs cannot leak out. They are separate hosts rather than one shared root
 * because the trigger must stay alive while no card exists, and vanish when one
 * opens.
 */

import tokensCss from '@/styles/tokens.css?inline';
import cardCss from '@/styles/card.css?inline';
import triggerCss from '@/styles/trigger.css?inline';
import { CARD } from '@/shared/constants';

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
export function createShadowContainer(hostId: string): ShadowContainer {
  removeShadowContainer(hostId);

  const host = document.createElement('div');
  host.id = hostId;
  /**
   * The host occupies no space; the card inside is position: fixed.
   *
   * The `z-index` is load-bearing and must be on the **host**, not the card.
   * Without it the host is positioned with `z-index: auto`, so it creates no
   * stacking context and its whole shadow subtree paints in the same layer as
   * ordinary positioned content — behind every page element with `z-index >= 1`.
   * The card's own `position: fixed` stacking context orders only its children
   * and cannot lift the subtree out of the host's paint slot. Dropping this line
   * made the card invisible on Gmail, Slack, Notion and anything with a sticky
   * header, while everything else about it worked.
   *
   * `z-index` is safe here where `transform`/`filter`/`will-change` would not be:
   * it does not create a containing block, so the fixed card keeps resolving
   * against the viewport, which is what `positionBelow` assumes.
   */
  host.style.cssText =
    'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;';

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
  // Both surfaces get the whole sheet. It is a few kilobytes already inlined in
  // this bundle, and splitting it per surface buys nothing.
  style.textContent = `
    :host {
      all: initial;
      font-family: var(--font-sans);
      /*
       * The ceiling card.css caps the card against, derived here so the edge
       * margin keeps a single definition in CARD rather than being restated as a
       * literal in the stylesheet. 100vh is the containing frame's viewport,
       * which is the right reference for a position: fixed card under
       * all_frames.
       */
      --card-max-height: calc(100vh - ${CARD.margin * 2}px);
    }
    ${tokensCss}
    ${cardCss}
    ${triggerCss}
  `;
  return style;
}

export function removeShadowContainer(hostId: string): void {
  document.getElementById(hostId)?.remove();
}
