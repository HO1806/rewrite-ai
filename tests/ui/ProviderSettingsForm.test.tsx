import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProviderSettingsForm } from '@/ui/ProviderSettingsForm';
import { DEFAULT_SETTINGS, PROVIDERS, getProvider } from '@/shared/constants';
import { settingsSchema, type Settings } from '@/storage/settings';
import { registerModelsBridge } from '@/background/modelsBridge';
import { jsonResponse, stubFetch } from '../helpers/http';

function settings(overrides: Partial<Settings> = {}): Settings {
  return settingsSchema.parse({ ...DEFAULT_SETTINGS, ...overrides });
}

/**
 * Bypasses validation, for the mid-typing state the form must still render.
 * The options page holds unsaved edits locally, so an invalid value is
 * representable until the user saves.
 */
function unvalidatedSettings(overrides: Partial<Settings>): Settings {
  return { ...settings(), ...overrides };
}

describe('ProviderSettingsForm', () => {
  it('lists every provider once, in the shared order', () => {
    render(<ProviderSettingsForm settings={settings()} onChange={vi.fn()} />);

    const options = screen
      .getAllByRole('option')
      .filter((option) =>
        PROVIDERS.some(
          (provider) => provider.value === option.getAttribute('value'),
        ),
      );
    expect(options.map((option) => option.textContent)).toEqual(
      PROVIDERS.map((provider) => provider.label),
    );
  });

  /**
   * The credential-leak fix. A base URL configured for a custom server must not
   * survive a switch to a hosted provider, or the hosted provider's key is sent
   * to that host.
   */
  it('clears the base URL when switching to a provider that does not use one', async () => {
    const onChange = vi.fn();
    render(
      <ProviderSettingsForm
        settings={settings({
          provider: 'custom',
          baseUrl: 'https://attacker.test/v1',
        })}
        onChange={onChange}
      />,
    );

    await userEvent.selectOptions(
      screen.getByLabelText(/AI provider/i),
      'openai',
    );

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai', baseUrl: '' }),
    );
  });

  it('resets the model to the new provider default on switch', async () => {
    const onChange = vi.fn();
    render(<ProviderSettingsForm settings={settings()} onChange={onChange} />);

    await userEvent.selectOptions(
      screen.getByLabelText(/AI provider/i),
      'anthropic',
    );

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ model: getProvider('anthropic').models[0] }),
    );
  });

  it('prefills the Ollama host when switching to it', async () => {
    const onChange = vi.fn();
    render(<ProviderSettingsForm settings={settings()} onChange={onChange} />);

    await userEvent.selectOptions(
      screen.getByLabelText(/AI provider/i),
      'ollama',
    );

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://localhost:11434' }),
    );
  });

  it('hides the API key field for providers that need none', () => {
    render(
      <ProviderSettingsForm
        settings={settings({ provider: 'ollama' })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/API key/i)).toBeNull();
  });

  it('shows the base URL field only for providers that use one', () => {
    const { unmount } = render(
      <ProviderSettingsForm
        settings={settings({ provider: 'openai' })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/Base URL/i)).toBeNull();
    unmount();

    render(
      <ProviderSettingsForm
        settings={settings({ provider: 'ollama' })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Base URL/i)).toBeInTheDocument();
  });

  it('masks the API key until revealed', async () => {
    render(
      <ProviderSettingsForm
        settings={settings({ apiKey: 'sk-secret' })}
        onChange={vi.fn()}
      />,
    );

    const field = screen.getByLabelText(/API key/i);
    expect(field).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: /Show/ }));
    expect(field).toHaveAttribute('type', 'text');
  });

  it('warns that the key is sent to a user-supplied host', () => {
    render(
      <ProviderSettingsForm
        settings={settings({ provider: 'ollama' })}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/API key is sent to this host/i),
    ).toBeInTheDocument();
  });

  it('flags a base URL that would send the key over plain http', () => {
    render(
      <ProviderSettingsForm
        settings={unvalidatedSettings({
          provider: 'ollama',
          baseUrl: 'http://remote.test',
        })}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/Base URL/i)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/https URL/i);
  });

  it('accepts an http base URL on localhost', () => {
    render(
      <ProviderSettingsForm
        settings={settings({
          provider: 'ollama',
          baseUrl: 'http://localhost:11434',
        })}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/Base URL/i)).toHaveAttribute(
      'aria-invalid',
      'false',
    );
  });

  it('applies a model preset chip', async () => {
    const onChange = vi.fn();
    render(<ProviderSettingsForm settings={settings()} onChange={onChange} />);

    const preset = getProvider('openai').models[1]!;
    await userEvent.click(screen.getByRole('button', { name: preset }));

    expect(onChange).toHaveBeenCalledWith({ model: preset });
  });

  it('reports the temperature as a number', async () => {
    const onChange = vi.fn();
    render(<ProviderSettingsForm settings={settings()} onChange={onChange} />);

    const slider = screen.getByLabelText(/Creativity/i);
    await userEvent.clear(slider).catch(() => {});
    slider.dispatchEvent(new Event('input', { bubbles: true }));

    expect(screen.getByText('0.30')).toBeInTheDocument();
  });

  it('toggles streaming', async () => {
    const onChange = vi.fn();
    render(
      <ProviderSettingsForm
        settings={settings({ stream: true })}
        onChange={onChange}
      />,
    );

    await userEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith({ stream: false });
  });

  describe('compact variant', () => {
    it('hides the advanced fields', () => {
      render(
        <ProviderSettingsForm
          settings={settings()}
          onChange={vi.fn()}
          variant="compact"
        />,
      );

      expect(screen.queryByLabelText(/Response limit/i)).toBeNull();
      expect(screen.queryByLabelText(/Translate into/i)).toBeNull();
      expect(screen.queryByLabelText(/Appearance/i)).toBeNull();
    });
  });

  describe('full variant', () => {
    /** Both fields were stored and validated but editable in neither surface. */
    it('exposes the token limit and translate language', () => {
      render(<ProviderSettingsForm settings={settings()} onChange={vi.fn()} />);

      expect(screen.getByLabelText(/Response limit/i)).toHaveValue(2048);
      expect(screen.getByLabelText(/Translate into/i)).toHaveValue('English');
    });

    it('exposes the theme, which nothing previously read', async () => {
      const onChange = vi.fn();
      render(
        <ProviderSettingsForm settings={settings()} onChange={onChange} />,
      );

      await userEvent.selectOptions(
        screen.getByLabelText(/Appearance/i),
        'dark',
      );
      expect(onChange).toHaveBeenCalledWith({ theme: 'dark' });
    });
  });
});

/**
 * The model list, fetched from the provider.
 *
 * The bundled presets are a dated assertion — Groq retired both of this
 * extension's ids two months after announcing them, and the user met it as a 404
 * mid-rewrite. These drive the real bridge over the mocked message boundary
 * against a stubbed fetch, so the button is tested end to end rather than the
 * seam being mocked away.
 */
describe('ProviderSettingsForm loading models from the provider', () => {
  it('offers the bundled presets before anything is fetched', () => {
    render(<ProviderSettingsForm settings={settings()} onChange={vi.fn()} />);

    for (const model of getProvider(DEFAULT_SETTINGS.provider).models) {
      expect(screen.getByRole('button', { name: model })).toBeInTheDocument();
    }
  });

  it('replaces the presets with the provider catalogue', async () => {
    registerModelsBridge();
    stubFetch([
      jsonResponse({ data: [{ id: 'fetched-a' }, { id: 'fetched-b' }] }),
    ]);
    render(<ProviderSettingsForm settings={settings()} onChange={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /Load models/ }));

    expect(
      await screen.findByRole('button', { name: 'fetched-a' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'fetched-b' }),
    ).toBeInTheDocument();
    // The stale guess must be gone, not merged with the truth.
    const [firstPreset] = getProvider(DEFAULT_SETTINGS.provider).models;
    expect(
      screen.queryByRole('button', { name: firstPreset }),
    ).not.toBeInTheDocument();
  });

  it('selects a fetched model when clicked', async () => {
    registerModelsBridge();
    stubFetch([jsonResponse({ data: [{ id: 'fetched-a' }] })]);
    const onChange = vi.fn();
    render(<ProviderSettingsForm settings={settings()} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /Load models/ }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'fetched-a' }),
    );

    expect(onChange).toHaveBeenCalledWith({ model: 'fetched-a' });
  });

  /** A failure the user cannot see is worse than the stale list they had. */
  it('shows why the catalogue could not be loaded', async () => {
    registerModelsBridge();
    stubFetch([jsonResponse({ error: 'nope' }, { status: 401 })]);
    render(<ProviderSettingsForm settings={settings()} onChange={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /Load models/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Invalid API key/,
    );
  });

  it('says so when the provider returns an empty catalogue', async () => {
    registerModelsBridge();
    stubFetch([jsonResponse({ data: [] })]);
    render(<ProviderSettingsForm settings={settings()} onChange={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /Load models/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no models/i);
  });
});
