import { ProviderSettingsForm } from '@/ui/ProviderSettingsForm';
import { ShortcutRow } from '@/ui/ShortcutRow';
import type { Settings } from '@/storage/settings';

interface SettingsTabProps {
  settings: Settings;
  onChange: (partial: Partial<Settings>) => void;
  onOpenOptions: () => void;
}

export function SettingsTab({
  settings,
  onChange,
  onOpenOptions,
}: SettingsTabProps) {
  return (
    <div className="tabpanel">
      <ProviderSettingsForm
        settings={settings}
        onChange={onChange}
        variant="compact"
      />
      <ShortcutRow />
      <button type="button" className="button" onClick={onOpenOptions}>
        All settings
      </button>
    </div>
  );
}
