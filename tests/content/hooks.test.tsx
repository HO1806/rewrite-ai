import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { useFocusTrap } from '@/content/hooks/useFocusTrap';
import { useCardKeyboard } from '@/content/hooks/useCardKeyboard';

afterEach(cleanup);

function Dialog({ onDismiss = vi.fn() }: { onDismiss?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);

  return (
    <div ref={ref} role="dialog" tabIndex={-1} aria-label="Test dialog">
      <button type="button">first</button>
      <button type="button">middle</button>
      <button type="button" onClick={onDismiss}>
        last
      </button>
    </div>
  );
}

describe('useFocusTrap', () => {
  it('moves focus to the first control on open', () => {
    render(<Dialog />);
    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus();
  });

  it('focuses the container itself when it holds no controls', () => {
    function Empty() {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref);
      return <div ref={ref} role="dialog" tabIndex={-1} aria-label="Empty" />;
    }

    render(<Empty />);
    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  it('wraps forward from the last control to the first', async () => {
    render(<Dialog />);

    screen.getByRole('button', { name: 'last' }).focus();
    await userEvent.tab();

    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus();
  });

  it('wraps backward from the first control to the last', async () => {
    render(<Dialog />);

    screen.getByRole('button', { name: 'first' }).focus();
    await userEvent.tab({ shift: true });

    expect(screen.getByRole('button', { name: 'last' })).toHaveFocus();
  });

  it('leaves interior tab steps alone', async () => {
    render(<Dialog />);

    screen.getByRole('button', { name: 'first' }).focus();
    await userEvent.tab();

    expect(screen.getByRole('button', { name: 'middle' })).toHaveFocus();
  });

  /** Focus previously landed on <body> when the card closed. */
  it('restores focus to whatever was focused before', () => {
    const outside = document.createElement('button');
    outside.textContent = 'outside';
    document.body.appendChild(outside);
    outside.focus();

    const { unmount } = render(<Dialog />);
    expect(outside).not.toHaveFocus();

    unmount();
    expect(outside).toHaveFocus();

    outside.remove();
  });

  it('does not throw when the previously focused element is gone', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    const { unmount } = render(<Dialog />);
    outside.remove();

    expect(() => unmount()).not.toThrow();
  });
});

describe('useCardKeyboard', () => {
  function Host({
    onDismiss,
    onConfirm,
    canConfirm,
  }: {
    onDismiss: () => void;
    onConfirm: () => void;
    canConfirm: boolean;
  }) {
    useCardKeyboard({ onDismiss, onConfirm, canConfirm });
    return <p>listening</p>;
  }

  it('dismisses on Escape', async () => {
    const onDismiss = vi.fn();
    render(<Host onDismiss={onDismiss} onConfirm={vi.fn()} canConfirm />);

    await userEvent.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it.each([['{Control>}{Enter}{/Control}'], ['{Meta>}{Enter}{/Meta}']])(
    'confirms on %s',
    async (keys) => {
      const onConfirm = vi.fn();
      render(<Host onDismiss={vi.fn()} onConfirm={onConfirm} canConfirm />);

      await userEvent.keyboard(keys);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    },
  );

  it('does not confirm while the suggestion is still generating', async () => {
    const onConfirm = vi.fn();
    render(
      <Host onDismiss={vi.fn()} onConfirm={onConfirm} canConfirm={false} />,
    );

    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('ignores a plain Enter', async () => {
    const onConfirm = vi.fn();
    render(<Host onDismiss={vi.fn()} onConfirm={onConfirm} canConfirm />);

    await userEvent.keyboard('{Enter}');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  /**
   * Ctrl+Enter must not also reach the host page — in Gmail or Slack that sends
   * the message mid-replacement.
   */
  it('stops the shortcut from reaching the page', async () => {
    const pageHandler = vi.fn();
    document.addEventListener('keydown', pageHandler);

    render(<Host onDismiss={vi.fn()} onConfirm={vi.fn()} canConfirm />);
    await userEvent.keyboard('{Control>}{Enter}{/Control}');

    // The Control keydown itself is not intercepted; the Enter must be, or the
    // host page's own Ctrl+Enter binding fires too and sends the message.
    const keysSeen = pageHandler.mock.calls.map(
      ([event]) => (event as KeyboardEvent).key,
    );
    expect(keysSeen).not.toContain('Enter');

    document.removeEventListener('keydown', pageHandler);
  });

  it('stops Escape from reaching the page', async () => {
    const pageHandler = vi.fn();
    document.addEventListener('keydown', pageHandler);

    render(<Host onDismiss={vi.fn()} onConfirm={vi.fn()} canConfirm />);
    await userEvent.keyboard('{Escape}');

    expect(pageHandler).not.toHaveBeenCalled();
    document.removeEventListener('keydown', pageHandler);
  });

  it('lets other keys through to the page', async () => {
    const pageHandler = vi.fn();
    document.addEventListener('keydown', pageHandler);

    render(<Host onDismiss={vi.fn()} onConfirm={vi.fn()} canConfirm />);
    await userEvent.keyboard('a');

    expect(pageHandler).toHaveBeenCalled();
    document.removeEventListener('keydown', pageHandler);
  });

  it('stops listening once unmounted', async () => {
    const onDismiss = vi.fn();
    const { unmount } = render(
      <Host onDismiss={onDismiss} onConfirm={vi.fn()} canConfirm />,
    );

    unmount();
    await userEvent.keyboard('{Escape}');

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
