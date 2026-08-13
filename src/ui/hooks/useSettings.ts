/**
 * Settings state shared by the popup and the options page.
 *
 * Also keeps the two surfaces in sync: both used to hold an independent
 * snapshot, so with popup and options open at once, whichever saved last
 * silently reverted the other's changes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Settings,
  loadSettings,
  onSettingsChange,
  saveSettings,
} from '@/storage/settings';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import { settingsSchema } from '@/storage/settings';
import { getErrorMessage } from '@/shared/errors';

export type SaveState =
  | { status: 'idle' }
  | { status: 'saved' }
  | { status: 'error'; message: string };

export function useSettings(): {
  settings: Settings;
  isLoaded: boolean;
  saveState: SaveState;
  update: (partial: Partial<Settings>) => Promise<void>;
  setLocal: (partial: Partial<Settings>) => void;
} {
  const [settings, setSettings] = useState<Settings>(() =>
    settingsSchema.parse(DEFAULT_SETTINGS),
  );
  const [isLoaded, setIsLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const badgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let isActive = true;

    loadSettings()
      .then((loaded) => {
        if (!isActive) return;
        setSettings(loaded);
        setIsLoaded(true);
      })
      .catch((err: unknown) => {
        if (!isActive) return;
        setIsLoaded(true);
        setSaveState({ status: 'error', message: getErrorMessage(err) });
      });

    // Pick up changes made in the other surface.
    const unsubscribe = onSettingsChange((next) => {
      if (isActive) setSettings(next);
    });

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, []);

  // Every previous save-confirmation timer was left uncleared and fired after
  // the popup window had already been destroyed.
  useEffect(
    () => () => {
      if (badgeTimer.current !== null) clearTimeout(badgeTimer.current);
    },
    [],
  );

  const flashSaved = useCallback(() => {
    setSaveState({ status: 'saved' });
    if (badgeTimer.current !== null) clearTimeout(badgeTimer.current);
    badgeTimer.current = setTimeout(
      () => setSaveState({ status: 'idle' }),
      1500,
    );
  }, []);

  /** Optimistically apply locally, then persist. */
  const update = useCallback(
    async (partial: Partial<Settings>) => {
      const next = { ...settings, ...partial };
      setSettings(next);

      try {
        await saveSettings(next);
        flashSaved();
      } catch (err: unknown) {
        setSaveState({ status: 'error', message: getErrorMessage(err) });
      }
    },
    [settings, flashSaved],
  );

  /** Apply without persisting, for forms with an explicit save button. */
  const setLocal = useCallback((partial: Partial<Settings>) => {
    setSettings((previous) => ({ ...previous, ...partial }));
    setSaveState({ status: 'idle' });
  }, []);

  return { settings, isLoaded, saveState, update, setLocal };
}
