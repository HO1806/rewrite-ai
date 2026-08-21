/**
 * The toolbar popup: one panel.
 *
 * It had three tabs. Playground went because "Load models" proves a key works
 * more directly than a test rewrite does, and Info went because the only thing
 * it showed — the live shortcut — belongs beside the settings it applies to.
 */

import { SaveStatus } from '@/ui/SaveStatus';
import { useSettings } from '@/ui/hooks/useSettings';
import { useAppliedTheme } from '@/ui/hooks/useAppliedTheme';
import { SettingsTab } from './tabs/SettingsTab';

export function App() {
  const { settings, saveState, update } = useSettings();

  useAppliedTheme(settings.theme);

  const openOptions = () => {
    if (chrome.runtime?.openOptionsPage) {
      void chrome.runtime.openOptionsPage();
    }
  };

  return (
    <div className="popup">
      <header className="app-header">
        <div className="app-identity">
          <span className="app-logo" aria-hidden="true">
            ⚡
          </span>
          <div>
            <h1 className="app-title">Rewrite AI</h1>
            <p className="app-subtitle">Select, rewrite, replace</p>
          </div>
        </div>
        <SaveStatus state={saveState} />
      </header>

      <SettingsTab
        settings={settings}
        onChange={update}
        onOpenOptions={openOptions}
      />
    </div>
  );
}
