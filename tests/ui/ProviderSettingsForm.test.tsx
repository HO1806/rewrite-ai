import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProviderSettingsForm } from '@/ui/ProviderSettingsForm';
import { DEFAULT_SETTINGS, PROVIDERS, getProvider } from '@/shared/constants';
import { settingsSchema, type Settings } from '@/storage/settings';

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
