import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyCardTheme,
  isCardMounted,
  mountCard,
  unmountCard,
} from '@/content/mount';
import { SHADOW_HOST_ID } from '@/shared/constants';

/** React's root teardown is deferred to a microtask. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function host(): HTMLElement | null {
  return document.getElementById(SHADOW_HOST_ID);
}

function cardText(): string {
  return host()?.shadowRoot?.textContent ?? '';
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(async () => {
  unmountCard();
  await settle();
  document.body.innerHTML = '';
});

describe('mountCard', () => {
  it('renders into a shadow root', async () => {
    mountCard(() => <p>hello card</p>);
    await settle();

    expect(host()).not.toBeNull();
    expect(host()!.shadowRoot).not.toBeNull();
    expect(cardText()).toContain('hello card');
  });

  it('injects the stylesheet into the shadow root', async () => {
    mountCard(() => <p>styled</p>);
    await settle();

    const style = host()!.shadowRoot!.querySelector('style');
    expect(style?.textContent).toContain('all: initial');
    expect(style?.textContent).toContain('.card');
  });

  it('hands the close callback to the render function', async () => {
    let close = () => {};
    mountCard((onClose) => {
      close = onClose;
      return <p>closable</p>;
    });
    await settle();

    close();
    await settle();

    expect(host()).toBeNull();
    expect(isCardMounted()).toBe(false);
  });

  it('replaces an existing card rather than stacking two', async () => {
    mountCard(() => <p>first</p>);
    await settle();
    mountCard(() => <p>second</p>);
    await settle();

    expect(document.querySelectorAll(`#${SHADOW_HOST_ID}`)).toHaveLength(1);
    expect(cardText()).toContain('second');
    expect(cardText()).not.toContain('first');
  });

  /**
   * The stranded-root regression. The React root used to be cached in a module
   * global while the mount point was looked up fresh, so once the host page
   * removed the host element the next mount rendered into a detached node and
   * the card was silently dead for the rest of the page's life.
   */
  it('still renders after the host element is removed externally', async () => {
    mountCard(() => <p>first</p>);
    await settle();

    // Simulate an SPA route change wiping the body.
    document.body.innerHTML = '';
    expect(host()).toBeNull();

    mountCard(() => <p>after external removal</p>);
    await settle();

    expect(host()).not.toBeNull();
    expect(cardText()).toContain('after external removal');
  });

  it('recovers when the whole document body is replaced repeatedly', async () => {
    for (const label of ['one', 'two', 'three']) {
      document.body.innerHTML = '';
      mountCard(() => <p>{label}</p>);
      await settle();
      expect(cardText()).toContain(label);
    }
  });
});

describe('unmountCard', () => {
  it('removes the host', async () => {
    mountCard(() => <p>x</p>);
    await settle();

    unmountCard();
    await settle();

    expect(host()).toBeNull();
  });

  it('is safe to call when nothing is mounted', () => {
    expect(() => unmountCard()).not.toThrow();
  });

  it('clears a host left behind by an earlier page state', async () => {
    const orphan = document.createElement('div');
    orphan.id = SHADOW_HOST_ID;
    document.body.appendChild(orphan);

    unmountCard();
    await settle();

    expect(host()).toBeNull();
  });
});

describe('applyCardTheme', () => {
  it('sets the theme attribute on the shadow host', async () => {
    mountCard(() => <p>themed</p>);
    await settle();

    applyCardTheme('light');
    expect(host()!.getAttribute('data-theme')).toBe('light');

    applyCardTheme('dark');
    expect(host()!.getAttribute('data-theme')).toBe('dark');
  });

  it('is a no-op when nothing is mounted', () => {
    expect(() => applyCardTheme('light')).not.toThrow();
  });
});
