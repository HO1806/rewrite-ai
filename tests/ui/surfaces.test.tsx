import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as PopupApp } from '@/popup/App';
import { App as OptionsApp } from '@/options/App';
import { registerStreamHandler } from '@/background/streamHandler';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '@/shared/constants';
import { loadSettings, saveSettings, settingsSchema } from '@/storage/settings';
import { chromeMock } from '../setup';
import { sseResponse, stubFetchEach } from '../helpers/http';

afterEach(cleanup);

function frames(text: string): string[] {
  return [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`,
    'data: [DONE]',
  ];
}

async function seed(overrides: Record<string, unknown> = {}): Promise<void> {
  await saveSettings(
    settingsSchema.parse({
      ...DEFAULT_SETTINGS,
      apiKey: 'sk-test',
      ...overrides,
    }),
  );
}

describe('popup', () => {
  it('presents its sections as an accessible tablist', async () => {
    await seed();
    render(<PopupApp />);

    const tablist = await screen.findByRole('tablist', {
      name: /Popup sections/i,
    });
    expect(within(tablist).getAllByRole('tab')).toHaveLength(3);
  });

  it('switches tab with the arrow keys', async () => {
    await seed();
    render(<PopupApp />);

    const tablist = await screen.findByRole('tablist', {
      name: /Popup sections/i,
    });
    await userEvent.click(within(tablist).getByRole('tab', { name: /Setup/ }));
    await userEvent.keyboard('{ArrowRight}');

    expect(
      within(tablist).getByRole('tab', { name: /Playground/ }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  it('persists an edit immediately and confirms it', async () => {
    await seed();
    render(<PopupApp />);

    const model = await screen.findByLabelText(/^Model$/i);
    await userEvent.clear(model);
    await userEvent.type(model, 'gpt-4o');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Saved'),
    );
    await expect(loadSettings()).resolves.toMatchObject({ model: 'gpt-4o' });
  });

  it('reports a save failure instead of failing silently', async () => {
    await seed();
    render(<PopupApp />);

    // An empty model violates the schema, so the save must reject.
    const model = await screen.findByLabelText(/^Model$/i);
    await userEvent.clear(model);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/model/i),
    );
  });

  it('shows the configured provider and key status in the info tab', async () => {
    await seed({ provider: 'groq' });
    render(<PopupApp />);

    await userEvent.click(await screen.findByRole('tab', { name: /Info/ }));

    expect(screen.getByText('Groq (ultra fast)')).toBeInTheDocument();
    expect(screen.getByText('Configured')).toBeInTheDocument();
  });

  it('reports a missing key in the info tab', async () => {
    await seed({ apiKey: '' });
    render(<PopupApp />);

    await userEvent.click(await screen.findByRole('tab', { name: /Info/ }));
    expect(screen.getByText('Not set')).toBeInTheDocument();
  });

  it('reads the real keyboard shortcut from the browser', async () => {
    await seed();
    render(<PopupApp />);

    await waitFor(() => expect(screen.getByText('Alt+H')).toBeInTheDocument());
  });

  it('reports a cleared shortcut rather than showing a stale default', async () => {
    await seed();
    vi.mocked(chrome.commands.getAll).mockImplementation(
      (callback: (commands: chrome.commands.Command[]) => void) =>
        callback([{ name: 'improve-writing', shortcut: '' }]),
    );

    render(<PopupApp />);
    await waitFor(() =>
      expect(screen.getByText('Not set')).toBeInTheDocument(),
    );
  });

  it('opens the full options page on request', async () => {
    await seed();
    render(<PopupApp />);

    await userEvent.click(
      await screen.findByRole('button', { name: /All settings/i }),
    );
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
  });

  describe('playground', () => {
    it('streams a result through the real port protocol', async () => {
      await seed();
      registerStreamHandler();
      stubFetchEach(() =>
        sseResponse(frames('They are going to the meeting.')),
      );

      render(<PopupApp />);
      await userEvent.click(
        await screen.findByRole('tab', { name: /Playground/ }),
      );
      await userEvent.click(screen.getByRole('button', { name: /^Run$/ }));

      await waitFor(() =>
        expect(
          screen.getByText('They are going to the meeting.'),
        ).toBeInTheDocument(),
      );
    });

    /**
     * The popup's own copy of the port protocol kept no reference to its port and
     * never disconnected, so two runs interleaved into a single string.
     */
    it('does not interleave two runs', async () => {
      await seed();
      registerStreamHandler();
      stubFetchEach((index) =>
        sseResponse(frames(index === 0 ? 'first' : 'second')),
      );

      render(<PopupApp />);
      await userEvent.click(
        await screen.findByRole('tab', { name: /Playground/ }),
      );

      const run = screen.getByRole('button', { name: /^Run$/ });
      await userEvent.click(run);
      await waitFor(() =>
        expect(screen.getByText('first')).toBeInTheDocument(),
      );
      await userEvent.click(screen.getByRole('button', { name: /^Run$/ }));

      await waitFor(() =>
        expect(screen.getByText('second')).toBeInTheDocument(),
      );
      expect(screen.queryByText(/firstsecond|secondfirst/)).toBeNull();
    });

    it('surfaces a provider error as an alert', async () => {
      await seed();
      registerStreamHandler();
      stubFetchEach(
        () =>
          new Response(JSON.stringify({ error: { message: 'no' } }), {
            status: 401,
          }),
      );

      render(<PopupApp />);
      await userEvent.click(
        await screen.findByRole('tab', { name: /Playground/ }),
      );
      await userEvent.click(screen.getByRole('button', { name: /^Run$/ }));

      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(/Invalid API key/),
      );
    });

    it('refuses to run on empty input', async () => {
      await seed();
      render(<PopupApp />);

      await userEvent.click(
        await screen.findByRole('tab', { name: /Playground/ }),
      );
      await userEvent.clear(screen.getByLabelText(/^Text$/i));

      expect(screen.getByRole('button', { name: /^Run$/ })).toBeDisabled();
    });
  });
});

describe('options', () => {
  it('holds edits locally until saved', async () => {
    await seed();
    render(<OptionsApp />);

    const language = await screen.findByLabelText(/Translate into/i);
    await userEvent.clear(language);
    await userEvent.type(language, 'Japanese');

    // Nothing persisted yet.
    await expect(loadSettings()).resolves.toMatchObject({
      translateLanguage: 'English',
    });

    await userEvent.click(
      screen.getByRole('button', { name: /Save settings/i }),
    );
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Saved'),
    );
    await expect(loadSettings()).resolves.toMatchObject({
      translateLanguage: 'Japanese',
    });
  });

  it('exposes the token limit, which no surface previously did', async () => {
    await seed();
    render(<OptionsApp />);

    const limit = await screen.findByLabelText(/Response limit/i);
    await userEvent.clear(limit);
    await userEvent.type(limit, '4096');
    await userEvent.click(
      screen.getByRole('button', { name: /Save settings/i }),
    );

    await expect(loadSettings()).resolves.toMatchObject({ maxTokens: 4096 });
  });

  it('applies the theme to the document', async () => {
    await seed({ theme: 'light' });
    render(<OptionsApp />);

    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('light'),
    );
  });

  it('reports a rejected save', async () => {
    await seed();
    render(<OptionsApp />);

    const model = await screen.findByLabelText(/^Model$/i);
    await userEvent.clear(model);
    await userEvent.click(
      screen.getByRole('button', { name: /Save settings/i }),
    );

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/model/i),
    );
  });

  /** Both surfaces used to hold independent snapshots and clobber each other. */
  it('picks up a change made in another surface', async () => {
    await seed({ model: 'gpt-4o-mini' });
    render(<OptionsApp />);
    await screen.findByLabelText(/^Model$/i);

    await saveSettings(
      settingsSchema.parse({
        ...DEFAULT_SETTINGS,
        apiKey: 'sk-test',
        model: 'changed-elsewhere',
      }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText(/^Model$/i)).toHaveValue(
        'changed-elsewhere',
      ),
    );
  });

  it('recovers when stored settings are corrupt', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    chromeMock.storage[STORAGE_KEYS.SETTINGS] = {
      provider: 'nonsense',
      temperature: 99,
    };

    render(<OptionsApp />);

    await waitFor(() =>
      expect(screen.getByLabelText(/AI provider/i)).toHaveValue(
        DEFAULT_SETTINGS.provider,
      ),
    );
  });
});
