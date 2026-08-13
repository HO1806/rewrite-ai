import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RewriteCard } from '@/content/components/RewriteCard';
import { registerStreamHandler } from '@/background/streamHandler';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import { saveSettings, settingsSchema } from '@/storage/settings';
import type { SelectionInfo } from '@/shared/types';
import { sseResponse, stubFetch, stubFetchEach } from '../helpers/http';

/**
 * These are end-to-end tests across the port: the card talks to the real stream
 * handler, which talks to a stubbed fetch. That is the boundary where the
 * disconnect-mid-stream and mislabelled-tone bugs actually lived.
 */
beforeEach(() => {
  registerStreamHandler();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function frames(...contents: string[]): string[] {
  return [
    ...contents.map(
      (content) =>
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
    ),
    'data: [DONE]',
  ];
}

function selectionIn(field: HTMLTextAreaElement): SelectionInfo {
  return {
    text: field.value,
    range: null,
    element: field,
    elementType: 'textarea',
    position: { top: 20, left: 20 },
    selectionStart: 0,
    selectionEnd: field.value.length,
  };
}

async function seedSettings(): Promise<void> {
  await saveSettings(
    settingsSchema.parse({ ...DEFAULT_SETTINGS, apiKey: 'sk-test' }),
  );
}

/** A focused textarea to act as the replacement target. */
function mountTextarea(value = 'orignal text'): HTMLTextAreaElement {
  const textarea = document.createElement('textarea');
  textarea.value = value;
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.setSelectionRange(0, value.length);
  return textarea;
}

describe('RewriteCard', () => {
  it('is a labelled modal dialog', async () => {
    await seedSettings();
    stubFetch([sseResponse(frames('Original text.'))]);
    const textarea = mountTextarea();

    render(
      <RewriteCard
        selectionInfo={selectionIn(textarea)}
        initialAction="improve"
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Here is another way of writing this');
  });

  it('streams the suggestion into a live region', async () => {
    await seedSettings();
    stubFetch([sseResponse(frames('Original ', 'text.'))]);
    const textarea = mountTextarea();

    render(
      <RewriteCard
        selectionInfo={selectionIn(textarea)}
        initialAction="improve"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText('Original text.')).toBeInTheDocument(),
    );
  });

  it('shows the action-specific heading', async () => {
    await seedSettings();
    stubFetch([sseResponse(frames('x'))]);
    const textarea = mountTextarea();

    render(
      <RewriteCard
        selectionInfo={selectionIn(textarea)}
        initialAction="translate"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Here is the translation')).toBeInTheDocument();
  });

  it('reports an error as an alert', async () => {
    await seedSettings();
    stubFetch([
      new Response(JSON.stringify({ error: { message: 'nope' } }), {
        status: 401,
      }),
    ]);
    const textarea = mountTextarea();

    render(
      <RewriteCard
        selectionInfo={selectionIn(textarea)}
        initialAction="improve"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Invalid API key/),
    );
  });

  it('disables the actions until a suggestion has arrived', async () => {
    await seedSettings();
    stubFetch([sseResponse(frames('done'))]);
    const textarea = mountTextarea();

    render(
      <RewriteCard
        selectionInfo={selectionIn(textarea)}
        initialAction="improve"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /^Replace$/ })).toBeDisabled();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Replace$/ })).toBeEnabled(),
    );
  });

  it('replaces the selection and reports success', async () => {
    await seedSettings();
    stubFetch([sseResponse(frames('Original text.'))]);
    document.execCommand = vi.fn(() => false) as typeof document.execCommand;
    const textarea = mountTextarea();

    render(
      <RewriteCard
        selectionInfo={selectionIn(textarea)}
        initialAction="improve"
        onClose={vi.fn()}
      />,
    );

    const replace = await waitFor(() => {
      const button = screen.getByRole('button', { name: /^Replace$/ });
      expect(button).toBeEnabled();
      return button;
    });

    await userEvent.click(replace);

    await waitFor(() => expect(textarea.value).toBe('Original text.'));
    expect(
      screen.getByRole('button', { name: /Replaced/ }),
    ).toBeInTheDocument();
  });

  /**
   * The card must not claim a replacement it did not make. A non-editable
   * selection can only be copied.
   */
  it('says "Copied instead" when the selection cannot be replaced', async () => {
    await seedSettings();
    stubFetch([sseResponse(frames('Improved.'))]);
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(() => Promise.resolve()) },
    });
    const onClose = vi.fn();

    render(
      <RewriteCard
        selectionInfo={{
          text: 'read only',
          range: null,
          element: null,
          elementType: 'unknown',
          position: { top: 0, left: 0 },
          selectionStart: null,
          selectionEnd: null,
        }}
        initialAction="improve"
        onClose={onClose}
      />,
    );

    const replace = await waitFor(() => {
      const button = screen.getByRole('button', { name: /^Replace$/ });
      expect(button).toBeEnabled();
      return button;
    });
    await userEvent.click(replace);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Copied instead/ }),
      ).toBeInTheDocument(),
    );
    // And it stays open, so the user can paste it themselves.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('copies the suggestion on demand', async () => {
    await seedSettings();
    stubFetch([sseResponse(frames('Copy me.'))]);
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    const textarea = mountTextarea();

    render(
      <RewriteCard
        selectionInfo={selectionIn(textarea)}
        initialAction="improve"
        onClose={vi.fn()}
      />,
    );

    const copy = await waitFor(() => {
      const button = screen.getByRole('button', { name: /^Copy$/ });
      expect(button).toBeEnabled();
      return button;
    });
    await userEvent.click(copy);

    expect(writeText).toHaveBeenCalledWith('Copy me.');
    await waitFor(() => expect(screen.getByText(/Copied/)).toBeInTheDocument());
  });

  it('closes on the close button', async () => {
    await seedSettings();
    stubFetch([sseResponse(frames('x'))]);
    const onClose = vi.fn();
    const textarea = mountTextarea();

    render(
      <RewriteCard
        selectionInfo={selectionIn(textarea)}
        initialAction="improve"
        onClose={onClose}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Close/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    await seedSettings();
    stubFetch([sseResponse(frames('x'))]);
    const onClose = vi.fn();
    const textarea = mountTextarea();

    render(
      <RewriteCard
        selectionInfo={selectionIn(textarea)}
        initialAction="improve"
        onClose={onClose}
      />,
    );

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  describe('adjust drawer', () => {
    async function openDrawer(): Promise<void> {
      const textarea = mountTextarea();
      render(
        <RewriteCard
          selectionInfo={selectionIn(textarea)}
          initialAction="improve"
          onClose={vi.fn()}
        />,
      );
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Adjust/ })).toBeEnabled(),
      );
      await userEvent.click(screen.getByRole('button', { name: /Adjust/ }));
    }

    it('exposes tone, format and length as tabs', async () => {
      await seedSettings();
      stubFetch([sseResponse(frames('x'))]);
      await openDrawer();

      const tablist = screen.getByRole('tablist', {
        name: /Adjust the rewrite/,
      });
      expect(within(tablist).getAllByRole('tab')).toHaveLength(3);
    });

    /**
     * The pill labelled "Funny" used to send the `neutral` tone, instructing the
     * model to be neutral and objective — the opposite of the label.
     */
    it('asks the model for humour when Funny is chosen', async () => {
      await seedSettings();
      const calls = stubFetchEach(() => sseResponse(frames('ha')));
      await openDrawer();

      await userEvent.click(screen.getByRole('button', { name: /Funny/ }));

      await waitFor(() => expect(calls.length).toBeGreaterThan(1));
      const body = String(calls[calls.length - 1]!.init.body);
      expect(body).toMatch(/humorous/i);
      expect(body).not.toMatch(/neutral and objective/i);
    });

    it('counts the adjustments applied', async () => {
      await seedSettings();
      stubFetch([sseResponse(frames('x'))]);
      await openDrawer();

      await userEvent.click(
        screen.getByRole('button', { name: /Professional/ }),
      );

      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /Adjust/ }),
        ).toHaveTextContent('1'),
      );
    });

    it('toggles a selected option back off', async () => {
      await seedSettings();
      stubFetch([sseResponse(frames('x'))]);
      await openDrawer();

      const pill = screen.getByRole('button', { name: /Casual/ });
      await userEvent.click(pill);
      await waitFor(() => expect(pill).toHaveAttribute('aria-pressed', 'true'));

      await userEvent.click(pill);
      await waitFor(() =>
        expect(pill).toHaveAttribute('aria-pressed', 'false'),
      );
    });

    /** Clicking a pill mid-stream used to crash the service worker. */
    it('survives an adjustment chosen while a stream is running', async () => {
      await seedSettings();
      // A fresh body per call, since each adjustment supersedes the last request.
      stubFetchEach(() => sseResponse(frames('revised')));
      await openDrawer();

      await userEvent.click(
        screen.getByRole('button', { name: /Enthusiastic/ }),
      );
      await userEvent.click(screen.getByRole('button', { name: /Casual/ }));

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^Replace$/ })).toBeEnabled(),
      );
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('switches category with the arrow keys', async () => {
      await seedSettings();
      stubFetch([sseResponse(frames('x'))]);
      await openDrawer();

      const tablist = screen.getByRole('tablist', {
        name: /Adjust the rewrite/,
      });
      await userEvent.click(within(tablist).getByRole('tab', { name: /Tone/ }));
      await userEvent.keyboard('{ArrowRight}');

      expect(
        within(tablist).getByRole('tab', { name: /Format/ }),
      ).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('regenerates on demand', async () => {
    await seedSettings();
    const calls = stubFetch([sseResponse(frames('again'))]);
    const textarea = mountTextarea();

    render(
      <RewriteCard
        selectionInfo={selectionIn(textarea)}
        initialAction="improve"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(calls).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: /Regenerate/ }));
    await waitFor(() => expect(calls).toHaveLength(2));
  });
});
