import { ACTIONS, getProvider } from '@/shared/constants';
import { ShortcutRow } from '@/ui/ShortcutRow';
import type { Settings } from '@/storage/settings';

export function InfoTab({ settings }: { settings: Settings }) {
  const descriptor = getProvider(settings.provider);
  const isConfigured = !descriptor.needsApiKey || settings.apiKey.length > 0;

  return (
    <div className="tabpanel">
      <div className="panel tabpanel">
        <div className="kv-row">
          <span className="kv-row__key">Provider</span>
          <span>{descriptor.label}</span>
        </div>
        <div className="kv-row">
          <span className="kv-row__key">Model</span>
          <span>{settings.model}</span>
        </div>
        <div className="kv-row">
          <span className="kv-row__key">API key</span>
          <span
            style={{ color: isConfigured ? 'var(--success)' : 'var(--danger)' }}
          >
            {isConfigured ? 'Configured' : 'Not set'}
          </span>
        </div>
        <ShortcutRow />
      </div>

      <div className="field">
        <span className="field__label">Available actions</span>
        <span className="text-muted">
          Select text on any page, then right-click and choose Rewrite AI:{' '}
          {ACTIONS.map((action) => action.label).join(', ')}.
        </span>
      </div>

      <div className="field">
        <span className="field__label">Privacy</span>
        <span className="text-muted">
          Your key is stored locally and never synced. Text is sent only to the
          provider you configure, from the extension&apos;s background worker.
        </span>
      </div>
    </div>
  );
}
