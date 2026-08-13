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
  settingsSchema,
} from '@/storage/settings';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import { getErrorMessage } from '@/shared/errors';

/** Long enough to coalesce typing, short enough to feel immediate. */
const WRITE_DEBOUNCE_MS = 400;

export type SaveState =
  | { status: 'idle' }
  | { status: 'saved' }
  | { status: 'error'; message: string };

export function useSettings(): {
  settings: Settings;
  isLoaded: boolean;
  saveState: SaveState;
  update: (partial: Partial<Settings>) => void;
  setLocal: (partial: Partial<Settings>) => void;
  flush: () => Promise<void>;
} {
  const [settings, setSettings] = useState<Settings>(() =>
    settingsSchema.parse(DEFAULT_SETTINGS),
  );
  const [isLoaded, setIsLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const badgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Latest local state, so callbacks need not depend on it and go stale. */
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /** What we last wrote, so our own storage echo can be recognised. */
  const pendingRef = useRef<Settings | null>(null);

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

    // Pick up changes made in the other surface — but ignore the echo of our own
    // write, which arrives asynchronously and would otherwise overwrite newer
    // local edits with a stale snapshot.
    const unsubscribe = onSettingsChange((next) => {
      if (!isActive) return;
      if (pendingRef.current && isSameSettings(pendingRef.current, next)) {
        pendingRef.current = null;
        return;
      }
      setSettings(next);
    });

    return () => {
      isActive = false;
      unsubscribe();
      if (writeTimer.current !== null) clearTimeout(writeTimer.current);
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

  /**
   * Apply locally at once, persist on a short debounce.
   *
   * The debounce is not just an optimisation. Writing on every keystroke means
   * `chrome.storage.onChanged` fires on every keystroke too, and that echo is an
   * async IPC hop — a stale one landing after a newer keystroke would rewrite the
   * controlled input backwards, dropping characters and jumping the caret. A
   * 50-character API key was also being written to storage 50 times.
   */
  const update = useCallback(
    (partial: Partial<Settings>) => {
      const next = { ...settingsRef.current, ...partial };
      setSettings(next);
      // The echo for our own write must not clobber newer local edits.
      pendingRef.current = next;

      if (writeTimer.current !== null) clearTimeout(writeTimer.current);
      writeTimer.current = setTimeout(() => {
        writeTimer.current = null;
        void saveSettings(next)
          .then(flashSaved)
          .catch((err: unknown) =>
            setSaveState({ status: 'error', message: getErrorMessage(err) }),
          );
      }, WRITE_DEBOUNCE_MS);
    },
    [flashSaved],
  );

  /** Persist immediately, for an explicit Save button. */
  const flush = useCallback(async () => {
    if (writeTimer.current !== null) {
      clearTimeout(writeTimer.current);
      writeTimer.current = null;
    }
    try {
      await saveSettings(settingsRef.current);
      flashSaved();
    } catch (err: unknown) {
      setSaveState({ status: 'error', message: getErrorMessage(err) });
    }
  }, [flashSaved]);

  /** Apply without persisting, for forms with an explicit save button. */
  const setLocal = useCallback((partial: Partial<Settings>) => {
    setSettings((previous) => ({ ...previous, ...partial }));
    setSaveState({ status: 'idle' });
  }, []);

  return { settings, isLoaded, saveState, update, setLocal, flush };
}

/** Field-wise comparison; Settings is flat, so this is enough. */
function isSameSettings(a: Settings, b: Settings): boolean {
  return (Object.keys(a) as Array<keyof Settings>).every(
    (key) => a[key] === b[key],
  );
}
