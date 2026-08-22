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
import type { EditableSelection } from '@/shared/types';
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

/** A range over page text with no editing host: nothing can write into it. */
function rangeOver(text: string): Range {
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  document.body.appendChild(paragraph);

  const range = document.createRange();
  range.selectNodeContents(paragraph.firstChild!);
  return range;
}

function frames(...contents: string[]): string[] {
  return [
    ...contents.map(
      (content) =>
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
    ),
    'data: [DONE]',
  ];
}

function selectionIn(field: HTMLTextAreaElement): EditableSelection {
  return {
    kind: 'field',
    text: field.value,
    element: field,
    position: { top: 20, left: 20 },
    start: 0,
    end: field.value.length,
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
        initialLanguage="English"
        onLanguageChange={vi.fn()}
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
        initialLanguage="English"
        onLanguageChange={vi.fn()}
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
        initialLanguage="English"
        onLanguageChange={vi.fn()}
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
        initialLanguage="English"
        onLanguageChange={vi.fn()}
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
        initialLanguage="English"
        onLanguageChange={vi.fn()}
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
        initialLanguage="English"
        onLanguageChange={vi.fn()}
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
   * The card must not claim a replacement it did not make.
   *
   * The selection here is `rich` over a range with no editing host — the shape
   * an editor that refuses the edit leaves behind. It used to be a `static`
   * selection, which the card can no longer be handed at all.
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
          kind: 'rich',
          text: 'read only',
          range: rangeOver('read only'),
          position: { top: 0, left: 0 },
        }}
        initialAction="improve"
        initialLanguage="English"
        onLanguageChange={vi.fn()}
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
        initialLanguage="English"
        onLanguageChange={vi.fn()}
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

    /**
     * The accessible name, exactly — not a substring. The confirmation used to
     * be the string '✓ Copied', so a screen reader announced the glyph as part
     * of the button's name. The tick is an SVG beside the label now, as it is
     * on every other button in the card.
     */
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Copied' }),
      ).toBeInTheDocument(),
    );
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
        initialLanguage="English"
        onLanguageChange={vi.fn()}
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
        initialLanguage="English"
        onLanguageChange={vi.fn()}
        onClose={onClose}
      />,
    );

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  /**
   * The two tabs replaced the adjust drawer, and are the only way to reach
   * Translate now that the right-click menu is gone.
   */
  describe('the mode tabs', () => {
    async function renderCard(
      onLanguageChange = vi.fn(),
    ): Promise<HTMLTextAreaElement> {
      const textarea = mountTextarea();
      render(
        <RewriteCard
          selectionInfo={selectionIn(textarea)}
          initialAction="improve"
          initialLanguage="English"
          onLanguageChange={onLanguageChange}
          onClose={vi.fn()}
        />,
      );
      return textarea;
    }

    it('offers Rewrite and Translate', async () => {
      await seedSettings();
      stubFetch([sseResponse(frames('ok'))]);
      await renderCard();

      const tablist = await screen.findByRole('tablist', { name: /Mode/i });
      expect(
        within(tablist).getByRole('tab', { name: /Rewrite/ }),
      ).toHaveAttribute('aria-selected', 'true');
      expect(
        within(tablist).getByRole('tab', { name: /Translate/ }),
      ).toBeInTheDocument();
    });

    it('re-runs the same selection through the other action', async () => {
      await seedSettings();
      const calls = stubFetchEach(() => sseResponse(frames('ok')));
      await renderCard();

      await waitFor(() => expect(calls).toHaveLength(1));
      await userEvent.click(screen.getByRole('tab', { name: /Translate/ }));

      await waitFor(() => expect(calls).toHaveLength(2));
      const body = String(calls[1]!.init.body);
      expect(body).toContain('Task: Translate.');
    });

    /** The gear belongs to Translate; on Rewrite it would do nothing. */
    it('shows the language gear only on the Translate tab', async () => {
      await seedSettings();
      stubFetchEach(() => sseResponse(frames('ok')));
      await renderCard();

      expect(screen.queryByRole('button', { name: /Language/i })).toBeNull();

      await userEvent.click(screen.getByRole('tab', { name: /Translate/ }));
      expect(
        await screen.findByRole('button', { name: /Language: English/i }),
      ).toBeInTheDocument();
    });

    /**
     * The regression that made this audit worth running. Roving `tabIndex` puts
     * -1 on the inactive tab, so without an arrow-key handler it is unreachable
     * by keyboard entirely — on an extension whose only entry point is a
     * keyboard shortcut. The comment claimed arrow keys worked; the handler had
     * been lost when the shared Tabs component was deleted.
     */
    it('moves between tabs with the arrow keys', async () => {
      await seedSettings();
      const calls = stubFetchEach(() => sseResponse(frames('ok')));
      await renderCard();

      const rewrite = await screen.findByRole('tab', { name: /Rewrite/ });
      rewrite.focus();
      await waitFor(() => expect(calls).toHaveLength(1));

      await userEvent.keyboard('{ArrowRight}');

      expect(screen.getByRole('tab', { name: /Translate/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      // Focus follows selection, or the next arrow press acts on the wrong tab.
      expect(screen.getByRole('tab', { name: /Translate/ })).toHaveFocus();
      await waitFor(() => expect(calls).toHaveLength(2));
    });

    it('wraps around, and Home and End jump to the ends', async () => {
      await seedSettings();
      stubFetchEach(() => sseResponse(frames('ok')));
      await renderCard();

      (await screen.findByRole('tab', { name: /Rewrite/ })).focus();

      await userEvent.keyboard('{ArrowLeft}');
      expect(screen.getByRole('tab', { name: /Translate/ })).toHaveFocus();

      await userEvent.keyboard('{Home}');
      expect(screen.getByRole('tab', { name: /Rewrite/ })).toHaveFocus();

      await userEvent.keyboard('{End}');
      expect(screen.getByRole('tab', { name: /Translate/ })).toHaveFocus();
    });

    /**
     * Interactive content inside a <button> is invalid HTML, and the nested
     * control leaked its own label into the tab's accessible name.
     */
    it('keeps the gear out of the tab button', async () => {
      await seedSettings();
      stubFetchEach(() => sseResponse(frames('ok')));
      await renderCard();

      await userEvent.click(
        await screen.findByRole('tab', { name: /Translate/ }),
      );

      const gear = await screen.findByRole('button', {
        name: /Language: English/,
      });
      expect(gear.closest('[role="tab"]')).toBeNull();
      // The tab's name must be the mode, not the mode plus the gear's label.
      expect(
        screen.getByRole('tab', { name: 'Translate' }),
      ).toBeInTheDocument();
    });

    it('picks a language, persists it and translates again', async () => {
      await seedSettings();
      const calls = stubFetchEach(() => sseResponse(frames('ok')));
      const onLanguageChange = vi.fn();
      await renderCard(onLanguageChange);

      await userEvent.click(screen.getByRole('tab', { name: /Translate/ }));
      await userEvent.click(
        await screen.findByRole('button', { name: /Language: English/i }),
      );
      await userEvent.selectOptions(
        await screen.findByLabelText(/Translate into/i),
        'German',
      );

      expect(onLanguageChange).toHaveBeenCalledWith('German');
      await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(3));
    });

    /**
     * The worker reads the stored language when it builds the prompt, so a
     * re-run that starts before the write lands translates into the *previous*
     * language — and Regenerate then appears to "fix" it.
     */
    it('waits for the language to persist before translating again', async () => {
      await seedSettings();
      const calls = stubFetchEach(() => sseResponse(frames('ok')));
      const order: string[] = [];
      const onLanguageChange = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push('saved');
      });
      await renderCard(onLanguageChange);

      await userEvent.click(
        await screen.findByRole('tab', { name: /Translate/ }),
      );
      const before = calls.length;
      await userEvent.click(
        await screen.findByRole('button', { name: /Language: English/i }),
      );
      await userEvent.selectOptions(
        await screen.findByLabelText(/Translate into/i),
        'German',
      );

      await waitFor(() => expect(calls.length).toBeGreaterThan(before));
      order.push('requested');
      expect(order).toEqual(['saved', 'requested']);
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
        initialLanguage="English"
        onLanguageChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(calls).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: /Regenerate/ }));
    await waitFor(() => expect(calls).toHaveLength(2));
  });
});
