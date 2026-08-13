import { describe, expect, it, vi } from 'vitest';
import {
  getStorage,
  onStorageChange,
  removeStorage,
  setStorage,
} from '@/storage/index';
import { chromeMock } from '../setup';

describe('storage wrapper', () => {
  it('round-trips a value', async () => {
    await setStorage('key', { nested: true });
    await expect(getStorage<{ nested: boolean }>('key')).resolves.toEqual({
      nested: true,
    });
  });

  it('returns undefined for a missing key', async () => {
    await expect(getStorage('absent')).resolves.toBeUndefined();
  });

  it('removes a value', async () => {
    await setStorage('key', 'value');
    await removeStorage('key');
    await expect(getStorage('key')).resolves.toBeUndefined();
  });
});

describe('onStorageChange', () => {
  it('reports the new and old values for the watched key', async () => {
    const listener = vi.fn();
    await setStorage('watched', 'before');
    onStorageChange<string>('watched', listener);

    await setStorage('watched', 'after');

    expect(listener).toHaveBeenCalledWith('after', 'before');
  });

  it('ignores changes to other keys', async () => {
    const listener = vi.fn();
    onStorageChange('watched', listener);

    await setStorage('unrelated', 'value');

    expect(listener).not.toHaveBeenCalled();
  });

  /** Only the local area is used, so a sync-area change must be ignored. */
  it('ignores changes from a different storage area', () => {
    const listener = vi.fn();
    onStorageChange('watched', listener);

    for (const registered of chromeMock.listeners.storageChange) {
      registered({ watched: { oldValue: 'a', newValue: 'b' } }, 'sync');
    }

    expect(listener).not.toHaveBeenCalled();
  });

  it('stops reporting after unsubscribe', async () => {
    const listener = vi.fn();
    const unsubscribe = onStorageChange('watched', listener);
    unsubscribe();

    await setStorage('watched', 'value');

    expect(listener).not.toHaveBeenCalled();
  });
});
