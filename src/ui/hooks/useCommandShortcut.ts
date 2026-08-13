/**
 * The keyboard shortcut currently bound to the rewrite command.
 *
 * This block was byte-identical in the popup and the options page.
 */

import { useEffect, useState } from 'react';

const COMMAND_NAME = 'improve-writing';

/** Fallback matches the `suggested_key` in the manifest. */
const DEFAULT_SHORTCUT = 'Ctrl+Shift+D';

export function useCommandShortcut(): {
  shortcut: string;
  openShortcutSettings: () => void;
} {
  const [shortcut, setShortcut] = useState(DEFAULT_SHORTCUT);

  useEffect(() => {
    if (!chrome.commands?.getAll) return;

    let isActive = true;
    chrome.commands.getAll((commands) => {
      if (!isActive) return;
      const command = commands.find((entry) => entry.name === COMMAND_NAME);
      // An empty shortcut means the user cleared the binding.
      setShortcut(command?.shortcut || 'Not set');
    });

    return () => {
      isActive = false;
    };
  }, []);

  return { shortcut, openShortcutSettings };
}

function openShortcutSettings(): void {
  const url = 'chrome://extensions/shortcuts';
  if (chrome.tabs?.create) {
    void chrome.tabs.create({ url });
    return;
  }
  window.open(url, '_blank');
}
