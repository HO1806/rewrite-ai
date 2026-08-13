import { ProviderSettingsForm } from '@/ui/ProviderSettingsForm';
import { SaveStatus } from '@/ui/SaveStatus';
import { ShortcutRow } from '@/ui/ShortcutRow';
import { useAppliedTheme } from '@/ui/hooks/useAppliedTheme';
import { useSettings } from '@/ui/hooks/useSettings';

export function App() {
  const { settings, isLoaded, saveState, setLocal, flush } = useSettings();

  useAppliedTheme(settings.theme);

  if (!isLoaded) {
    return (
      <main className="options">
        <p className="text-muted">Loading settings…</p>
      </main>
    );
  }

  return (
    <main className="options">
      <header className="app-header">
        <div className="app-identity">
          <span className="app-logo" aria-hidden="true">
            ⚡
          </span>
          <div>
            <h1 className="app-title">Rewrite AI settings</h1>
            <p className="app-subtitle">
              Bring your own key. Nothing leaves your browser except your
              prompt.
            </p>
          </div>
        </div>
        <SaveStatus state={saveState} />
      </header>

      <form
        className="panel tabpanel"
        onSubmit={(event) => {
          event.preventDefault();
          void flush();
        }}
      >
        <ProviderSettingsForm settings={settings} onChange={setLocal} />
        <ShortcutRow />
        <button type="submit" className="button button--primary">
          Save settings
        </button>
      </form>
    </main>
  );
}
