/**
 * A Chrome extension API test double.
 *
 * The previous mock covered exactly the four tests that existed and no more —
 * `chrome.tabs` was absent entirely despite being used by the background worker
 * and the popup, as were `scripting`, `commands.getAll`, `runtime.connect` and
 * `storage.onChanged.removeListener`. Its storage object was also a module-level
 * value that nothing reset, which made the settings tests order-dependent.
 */

import { vi } from 'vitest';

export type StorageChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) => void;

export interface ChromeMock {
  storage: Record<string, unknown>;
  listeners: {
    storageChange: StorageChangeListener[];
    message: Array<
      (
        message: unknown,
        sender: unknown,
        respond: (value?: unknown) => void,
      ) => unknown
    >;
    connect: Array<(port: MockPort) => void>;
    contextMenuClick: Array<(info: unknown, tab?: unknown) => void>;
    command: Array<(command: string, tab?: unknown) => void>;
    installed: Array<() => void>;
    startup: Array<() => void>;
  };
  createdMenus: chrome.contextMenus.CreateProperties[];
  executedScripts: chrome.scripting.ScriptInjection<[], unknown>[];
  sentTabMessages: Array<{ tabId: number; message: unknown }>;
  /** Set to make chrome.tabs.sendMessage reject, simulating a missing content script. */
  tabMessageError: string | null;
  /** Set to make chrome.scripting.executeScript reject. */
  executeScriptError: string | null;
  manifest: chrome.runtime.Manifest;
  lastError: { message: string } | undefined;
}

/** A two-ended port pair for exercising the streaming protocol. */
export class MockPort {
  readonly name: string;
  /** Messages sent from this end. */
  readonly posted: unknown[] = [];
  /** Messages delivered to this end. */
  readonly inbox: unknown[] = [];
  isDisconnected = false;

  private messageListeners: Array<(message: unknown) => void> = [];
  private disconnectListeners: Array<() => void> = [];

  /** The other end, which receives what this end posts. */
  peer: MockPort | null = null;

  constructor(name: string) {
    this.name = name;
  }

  onMessage = {
    addListener: (listener: (message: unknown) => void) => {
      this.messageListeners.push(listener);
    },
    removeListener: (listener: (message: unknown) => void) => {
      this.messageListeners = this.messageListeners.filter(
        (entry) => entry !== listener,
      );
    },
  };

  onDisconnect = {
    addListener: (listener: () => void) => {
      this.disconnectListeners.push(listener);
    },
    removeListener: (listener: () => void) => {
      this.disconnectListeners = this.disconnectListeners.filter(
        (entry) => entry !== listener,
      );
    },
  };

  postMessage = (message: unknown): void => {
    if (this.isDisconnected) {
      throw new Error('Attempting to use a disconnected port object');
    }
    this.posted.push(message);
    this.peer?.receive(message);
  };

  disconnect = (): void => {
    if (this.isDisconnected) return;
    this.isDisconnected = true;
    this.peer?.notifyDisconnect();
  };

  /** Deliver a message to this end's listeners. */
  receive(message: unknown): void {
    this.inbox.push(message);
    for (const listener of [...this.messageListeners]) listener(message);
  }

  notifyDisconnect(): void {
    this.isDisconnected = true;
    for (const listener of [...this.disconnectListeners]) listener();
  }
}

/** Create a connected pair; index 0 is the client end, index 1 the server end. */
export function createPortPair(name: string): [MockPort, MockPort] {
  const client = new MockPort(name);
  const server = new MockPort(name);
  client.peer = server;
  server.peer = client;
  return [client, server];
}

export function installChromeMock(): ChromeMock {
  const state: ChromeMock = {
    storage: {},
    listeners: {
      storageChange: [],
      message: [],
      connect: [],
      contextMenuClick: [],
      command: [],
      installed: [],
      startup: [],
    },
    createdMenus: [],
    executedScripts: [],
    sentTabMessages: [],
    tabMessageError: null,
    executeScriptError: null,
    manifest: {
      manifest_version: 3,
      name: 'Rewrite AI',
      version: '1.0.0',
      content_scripts: [
        { matches: ['<all_urls>'], js: ['src/content/index.tsx'] },
      ],
    } as chrome.runtime.Manifest,
    lastError: undefined,
  };

  const emitStorageChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName = 'local',
  ) => {
    for (const listener of state.listeners.storageChange)
      listener(changes, areaName);
  };

  const chromeApi = {
    runtime: {
      get lastError() {
        return state.lastError;
      },
      getManifest: () => state.manifest,
      getURL: (path: string) => `chrome-extension://mock-id/${path}`,
      openOptionsPage: vi.fn(() => Promise.resolve()),
      onInstalled: {
        addListener: (fn: () => void) => state.listeners.installed.push(fn),
      },
      onStartup: {
        addListener: (fn: () => void) => state.listeners.startup.push(fn),
      },
      onConnect: {
        addListener: (fn: (port: MockPort) => void) =>
          state.listeners.connect.push(fn),
      },
      onMessage: {
        addListener: (fn: (typeof state.listeners.message)[number]) =>
          state.listeners.message.push(fn),
      },
      sendMessage: vi.fn(() => Promise.resolve()),
      connect: vi.fn(({ name }: { name: string }) => {
        const [client, server] = createPortPair(name);
        // Hand the server end to whatever registered onConnect.
        for (const listener of state.listeners.connect) listener(server);
        return client;
      }),
    },

    tabs: {
      create: vi.fn(() => Promise.resolve({})),
      sendMessage: vi.fn((tabId: number, message: unknown) => {
        if (state.tabMessageError)
          return Promise.reject(new Error(state.tabMessageError));
        state.sentTabMessages.push({ tabId, message });
        return Promise.resolve();
      }),
    },

    scripting: {
      executeScript: vi.fn(
        (injection: chrome.scripting.ScriptInjection<[], unknown>) => {
          if (state.executeScriptError)
            return Promise.reject(new Error(state.executeScriptError));
          state.executedScripts.push(injection);
          return Promise.resolve([]);
        },
      ),
    },

    contextMenus: {
      removeAll: vi.fn((callback?: () => void) => {
        state.createdMenus.length = 0;
        callback?.();
      }),
      create: vi.fn(
        (
          properties: chrome.contextMenus.CreateProperties,
          callback?: () => void,
        ) => {
          state.createdMenus.push(properties);
          callback?.();
          return properties.id ?? '';
        },
      ),
      onClicked: {
        addListener: (fn: (info: unknown, tab?: unknown) => void) =>
          state.listeners.contextMenuClick.push(fn),
      },
    },

    commands: {
      getAll: vi.fn((callback: (commands: chrome.commands.Command[]) => void) =>
        callback([{ name: 'improve-writing', shortcut: 'Alt+H' }]),
      ),
      onCommand: {
        addListener: (fn: (command: string, tab?: unknown) => void) =>
          state.listeners.command.push(fn),
      },
    },

    storage: {
      local: {
        get: vi.fn((key: string) =>
          Promise.resolve({ [key]: state.storage[key] }),
        ),
        set: vi.fn((items: Record<string, unknown>) => {
          const changes: Record<string, chrome.storage.StorageChange> = {};
          for (const [key, newValue] of Object.entries(items)) {
            changes[key] = { oldValue: state.storage[key], newValue };
            state.storage[key] = newValue;
          }
          emitStorageChange(changes);
          return Promise.resolve();
        }),
        remove: vi.fn((key: string) => {
          const oldValue = state.storage[key];
          delete state.storage[key];
          emitStorageChange({ [key]: { oldValue, newValue: undefined } });
          return Promise.resolve();
        }),
      },
      onChanged: {
        addListener: (fn: StorageChangeListener) =>
          state.listeners.storageChange.push(fn),
        removeListener: (fn: StorageChangeListener) => {
          state.listeners.storageChange = state.listeners.storageChange.filter(
            (entry) => entry !== fn,
          );
        },
      },
    },
  };

  Object.defineProperty(globalThis, 'chrome', {
    value: chromeApi,
    configurable: true,
    writable: true,
  });

  return state;
}
