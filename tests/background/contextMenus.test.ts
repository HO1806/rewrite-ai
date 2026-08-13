import { describe, expect, it, vi } from 'vitest';
import {
  rebuildContextMenus,
  registerContextMenus,
} from '@/background/contextMenus';
import { ACTIONS } from '@/shared/constants';
import { chromeMock } from '../setup';

describe('registerContextMenus', () => {
  /**
   * Registration is bound to lifecycle events only. It previously also ran as a
   * bare top-level call, re-registering on every service-worker wake and racing
   * the onInstalled listener into a duplicate-id failure.
   */
  it('registers for install and startup without building menus immediately', () => {
    registerContextMenus();

    expect(chromeMock.listeners.installed).toHaveLength(1);
    expect(chromeMock.listeners.startup).toHaveLength(1);
    expect(chromeMock.createdMenus).toHaveLength(0);
  });

  it('builds the menus when the install event fires', async () => {
    registerContextMenus();
    for (const listener of chromeMock.listeners.installed) listener();
    await vi.waitFor(() =>
      expect(chromeMock.createdMenus.length).toBeGreaterThan(0),
    );

    expect(chromeMock.createdMenus).toHaveLength(ACTIONS.length + 1);
  });

  it('builds the menus when the browser starts', async () => {
    registerContextMenus();
    for (const listener of chromeMock.listeners.startup) listener();
    await vi.waitFor(() =>
      expect(chromeMock.createdMenus.length).toBeGreaterThan(0),
    );

    expect(chromeMock.createdMenus).toHaveLength(ACTIONS.length + 1);
  });
});

describe('rebuildContextMenus', () => {
  it('creates a parent and one child per action, all selection-scoped', async () => {
    await rebuildContextMenus();

    const [parent, ...children] = chromeMock.createdMenus;
    expect(parent).toMatchObject({
      id: 'rewrite-ai-parent',
      title: 'Rewrite AI',
    });
    expect(children.map((child) => child.id)).toEqual(
      ACTIONS.map((action) => action.id),
    );

    for (const menu of chromeMock.createdMenus) {
      expect(menu.contexts).toEqual(['selection']);
    }
  });

  it('uses the shared action labels', async () => {
    await rebuildContextMenus();

    const titles = chromeMock.createdMenus.slice(1).map((menu) => menu.title);
    expect(titles).toEqual(ACTIONS.map((action) => action.label));
  });

  it('clears existing menus first, so a rebuild does not duplicate ids', async () => {
    await rebuildContextMenus();
    await rebuildContextMenus();

    expect(chromeMock.createdMenus).toHaveLength(ACTIONS.length + 1);
  });

  /**
   * The failure that put a red "Errors" badge on the extension card. Two
   * overlapping rebuilds used to interleave: the second `removeAll()` deleted the
   * parent between the first rebuild's parent-create and its children, so all
   * seven children failed with "Cannot find menu item" and no menu was left.
   * Reachable when onInstalled and onStartup both fire, or when the user hits
   * Reload while a rebuild is in flight.
   */
  it('serializes concurrent rebuilds instead of interleaving them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await Promise.all([
      rebuildContextMenus(),
      rebuildContextMenus(),
      rebuildContextMenus(),
    ]);

    expect(warn).not.toHaveBeenCalled();
    // Exactly one complete menu survives, not three partial ones.
    expect(chromeMock.createdMenus).toHaveLength(ACTIONS.length + 1);
    expect(chromeMock.createdMenus[0]).toMatchObject({
      id: 'rewrite-ai-parent',
    });
  });

  /** Without the parent, seven "Cannot find menu item" errors used to follow. */
  it('reports once and stops when the parent cannot be created', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    chromeMock.lastError = { message: 'duplicate id' };

    await rebuildContextMenus();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toMatch(/Reload the extension/);
    // No children were attempted.
    expect(chromeMock.createdMenus).toHaveLength(1);
  });

  /** lastError was checked nowhere in the codebase, hiding exactly this. */
  it('logs a warning when a menu cannot be created', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    chromeMock.lastError = { message: 'duplicate id' };

    await rebuildContextMenus();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('duplicate id'));
  });
});
