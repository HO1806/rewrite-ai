import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as PopupApp } from '@/popup/App';
import { App as OptionsApp } from '@/options/App';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '@/shared/constants';
import { loadSettings, saveSettings, settingsSchema } from '@/storage/settings';
import { chromeMock } from '../setup';

afterEach(cleanup);

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
  /**
   * One panel, no tabs. Playground went because "Load models" proves a key works
   * more directly, and Info because the shortcut it displayed belongs beside the
   * settings it applies to.
   */
  it('presents a single settings panel with no tablist', async () => {
    await seed();
    render(<PopupApp />);

    expect(await screen.findByLabelText('Model')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('still shows the shortcut it used to hide in an Info tab', async () => {
    await seed();
    render(<PopupApp />);

    expect(await screen.findByText(/shortcut/i)).toBeInTheDocument();
  });

  it('persists an edit immediately and confirms it', async () => {
    await seed();
    render(<PopupApp />);

    // The model is a dropdown now; picking from it is the edit.
    const model = await screen.findByLabelText(/^Model$/i);
    await userEvent.selectOptions(model, 'gpt-5.6-luna');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Saved'),
    );
    await expect(loadSettings()).resolves.toMatchObject({
      model: 'gpt-5.6-luna',
    });
  });

  it('reports a save failure instead of failing silently', async () => {
    await seed();
    render(<PopupApp />);

    // An empty model violates the schema, so the save must reject. Reaching that
    // state needs the typed-id escape hatch, since a dropdown cannot be emptied.
    await userEvent.click(
      await screen.findByRole('button', { name: /Type an id/ }),
    );
    await userEvent.clear(await screen.findByLabelText(/^Model$/i));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/model/i),
    );
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
});

describe('options', () => {
  it('holds edits locally until saved', async () => {
    await seed();
    render(<OptionsApp />);

    // The theme is the remaining editable field on this page besides the model.
    await userEvent.selectOptions(
      await screen.findByLabelText(/Appearance/i),
      'light',
    );

    // Nothing persisted yet.
    await expect(loadSettings()).resolves.toMatchObject({ theme: 'system' });

    await userEvent.click(
      screen.getByRole('button', { name: /Save settings/i }),
    );
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Saved'),
    );
    await expect(loadSettings()).resolves.toMatchObject({
      theme: 'light',
    });
  });

  /**
   * The response limit, creativity and streaming controls were removed while
   * keeping their values, so the options page must not offer them again.
   */
  it('no longer offers the settings that were fixed at their defaults', async () => {
    await seed();
    render(<OptionsApp />);

    await screen.findByLabelText('Model');
    expect(screen.queryByLabelText(/Response limit/i)).toBeNull();
    expect(screen.queryByLabelText(/Creativity/i)).toBeNull();
    expect(screen.queryByLabelText(/Translate into/i)).toBeNull();
  });

  it('reports a rejected save', async () => {
    await seed();
    render(<OptionsApp />);

    // An empty model violates the schema. The dropdown cannot produce one, so
    // this goes through the typed-id escape hatch.
    await userEvent.click(
      await screen.findByRole('button', { name: /Type an id/ }),
    );
    await userEvent.clear(await screen.findByLabelText(/^Model$/i));
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
