import { describe, expect, it, vi } from 'vitest';
import {
  isAllowedBaseUrl,
  loadSettings,
  onSettingsChange,
  saveSettings,
  settingsSchema,
  updateSettings,
} from '@/storage/settings';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '@/shared/constants';
import { chromeMock } from '../setup';

function valid(overrides: Record<string, unknown> = {}) {
  return settingsSchema.parse({ ...DEFAULT_SETTINGS, ...overrides });
}

describe('DEFAULT_SETTINGS', () => {
  /** Guards the deliberate lack of an import cycle between the two modules. */
  it('satisfies the schema', () => {
    expect(() => settingsSchema.parse(DEFAULT_SETTINGS)).not.toThrow();
  });
});

describe('loadSettings', () => {
  it('returns defaults and seeds storage when empty', async () => {
    await expect(loadSettings()).resolves.toEqual(valid());
    expect(chromeMock.storage[STORAGE_KEYS.SETTINGS]).toEqual(valid());
  });

  it('returns stored settings', async () => {
    await saveSettings(
      valid({ provider: 'groq', model: 'llama-3.3-70b-versatile' }),
    );

    const loaded = await loadSettings();
    expect(loaded.provider).toBe('groq');
    expect(loaded.model).toBe('llama-3.3-70b-versatile');
  });

  it('fills in fields missing from stored data', async () => {
    chromeMock.storage[STORAGE_KEYS.SETTINGS] = { provider: 'gemini' };

    const loaded = await loadSettings();
    expect(loaded.provider).toBe('gemini');
    expect(loaded.temperature).toBe(DEFAULT_SETTINGS.temperature);
  });

  /** The module's stated purpose, and previously untested. */
  it.each([
    ['an unknown provider', { provider: 'skynet' }],
    ['an out-of-range temperature', { temperature: 99 }],
    ['an empty model', { model: '' }],
    ['a non-numeric maxTokens', { maxTokens: 'lots' }],
    ['a disallowed base URL', { baseUrl: 'http://evil.test' }],
  ])('self-heals %s back to defaults', async (_label, corrupt) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    chromeMock.storage[STORAGE_KEYS.SETTINGS] = {
      ...DEFAULT_SETTINGS,
      ...corrupt,
    };

    await expect(loadSettings()).resolves.toEqual(valid());
    expect(chromeMock.storage[STORAGE_KEYS.SETTINGS]).toEqual(valid());
  });

  it('never logs stored values when reporting invalid settings', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    chromeMock.storage[STORAGE_KEYS.SETTINGS] = {
      ...DEFAULT_SETTINGS,
      apiKey: 'sk-super-secret',
      temperature: 99,
    };

    await loadSettings();

    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).not.toContain('sk-super-secret');
    expect(logged).toContain('temperature');
  });

  it('treats a non-object stored value as empty', async () => {
    chromeMock.storage[STORAGE_KEYS.SETTINGS] = 'corrupted';
    await expect(loadSettings()).resolves.toEqual(valid());
  });
});

describe('saveSettings', () => {
  it('persists valid settings', async () => {
    await saveSettings(valid({ translateLanguage: 'French' }));
    await expect(loadSettings()).resolves.toMatchObject({
      translateLanguage: 'French',
    });
  });

  it.each([
    ['an empty model', { model: '' }],
    ['a temperature above the maximum', { temperature: 2.5 }],
    ['a fractional token limit', { maxTokens: 1.5 }],
    ['a token limit of zero', { maxTokens: 0 }],
    ['an empty translate language', { translateLanguage: '' }],
  ])('rejects %s', async (_label, invalid) => {
    const settings = { ...valid(), ...invalid } as ReturnType<typeof valid>;
    await expect(saveSettings(settings)).rejects.toThrow();
  });
});

describe('updateSettings', () => {
  it('merges a partial update over stored settings', async () => {
    await saveSettings(
      valid({ provider: 'groq', translateLanguage: 'Italian' }),
    );

    const updated = await updateSettings({ temperature: 1.2 });
    expect(updated).toMatchObject({
      provider: 'groq',
      translateLanguage: 'Italian',
      temperature: 1.2,
    });
  });

  it('rejects an update that would be invalid', async () => {
    await expect(updateSettings({ temperature: 42 })).rejects.toThrow();
  });
});

describe('onSettingsChange', () => {
  it('notifies subscribers when settings are written', async () => {
    const listener = vi.fn();
    onSettingsChange(listener);

    await saveSettings(valid({ model: 'gpt-4o' }));

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o' }),
    );
  });

  it('stops notifying after unsubscribe', async () => {
    const listener = vi.fn();
    const unsubscribe = onSettingsChange(listener);
    unsubscribe();

    await saveSettings(valid({ model: 'gpt-4o' }));

    expect(listener).not.toHaveBeenCalled();
  });

  it('ignores a change that fails validation', async () => {
    const listener = vi.fn();
    onSettingsChange(listener);

    await chrome.storage.local.set({
      [STORAGE_KEYS.SETTINGS]: { temperature: 99 },
    });

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('isAllowedBaseUrl', () => {
  it.each([
    '',
    'https://api.example.com/v1',
    'http://localhost:11434',
    'http://127.0.0.1:8080',
  ])('accepts %s', (value) => {
    expect(isAllowedBaseUrl(value)).toBe(true);
  });

  /** Plain http to a remote host would send the API key in the clear. */
  it.each([
    'http://evil.test',
    'http://192.168.1.1:11434',
    'ftp://example.com',
    'file:///etc/passwd',
    'not a url',
    'javascript:alert(1)',
  ])('rejects %s', (value) => {
    expect(isAllowedBaseUrl(value)).toBe(false);
  });
});
