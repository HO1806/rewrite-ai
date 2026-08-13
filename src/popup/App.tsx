import { useState } from 'react';
import { Tabs, type TabDefinition } from '@/ui/Tabs';
import { SaveStatus } from '@/ui/SaveStatus';
import { useSettings } from '@/ui/hooks/useSettings';
import { useAppliedTheme } from '@/ui/hooks/useAppliedTheme';
import { InfoTab } from './tabs/InfoTab';
import { PlaygroundTab } from './tabs/PlaygroundTab';
import { SettingsTab } from './tabs/SettingsTab';

type TabId = 'settings' | 'playground' | 'info';

export function App() {
  const { settings, saveState, update } = useSettings();
  const [activeTab, setActiveTab] = useState<TabId>('settings');

  useAppliedTheme(settings.theme);

  const openOptions = () => {
    if (chrome.runtime?.openOptionsPage) {
      void chrome.runtime.openOptionsPage();
    }
  };

  const tabs: readonly TabDefinition<TabId>[] = [
    {
      id: 'settings',
      label: 'Setup',
      icon: '⚙️',
      render: () => (
        <SettingsTab
          settings={settings}
          onChange={update}
          onOpenOptions={openOptions}
        />
      ),
    },
    {
      id: 'playground',
      label: 'Playground',
      icon: '🧪',
      render: () => <PlaygroundTab />,
    },
    {
      id: 'info',
      label: 'Info',
      icon: 'ℹ️',
      render: () => <InfoTab settings={settings} />,
    },
  ];

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

      <Tabs
        tabs={tabs}
        activeId={activeTab}
        onChange={setActiveTab}
        label="Popup sections"
      />
    </div>
  );
}
