import { useCommandShortcut } from './hooks/useCommandShortcut';

/** The current keyboard shortcut, with a link to Chrome's shortcut settings. */
export function ShortcutRow() {
  const { shortcut, openShortcutSettings } = useCommandShortcut();

  return (
    <div className="kv-row">
      <span className="kv-row__key">Rewrite shortcut</span>
      <span className="row">
        <kbd className="kbd">{shortcut}</kbd>
        <button
          type="button"
          className="button button--subtle"
          onClick={openShortcutSettings}
        >
          Change
        </button>
      </span>
    </div>
  );
}
