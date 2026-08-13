/**
 * Type-safe wrapper around chrome.storage.local.
 *
 * Provides get/set/remove/onChange with proper typing instead of raw
 * chrome.storage calls scattered throughout the codebase.
 */

/**
 * Retrieve a value from chrome.storage.local.
 * Returns `undefined` if the key doesn't exist.
 */
export async function getStorage<T>(key: string): Promise<T | undefined> {
  const result = await chrome.storage.local.get(key);
  return result[key] as T | undefined;
}

/**
 * Store a value in chrome.storage.local.
 */
export async function setStorage<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

/**
 * Remove a key from chrome.storage.local.
 */
export async function removeStorage(key: string): Promise<void> {
  await chrome.storage.local.remove(key);
}

/**
 * Subscribe to changes on a specific key.
 * Returns an unsubscribe function.
 */
export function onStorageChange<T>(
  key: string,
  callback: (newValue: T | undefined, oldValue: T | undefined) => void,
): () => void {
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string,
  ) => {
    if (areaName !== 'local') return;

    const change = changes[key];
    if (!change) return;

    callback(
      change.newValue as T | undefined,
      change.oldValue as T | undefined,
    );
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
