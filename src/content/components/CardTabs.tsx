import { getAction } from '@/shared/constants';
import type { RewriteAction } from '@/shared/types';
import { GearIcon } from './icons';

interface CardTabsProps {
  action: RewriteAction;
  language: string;
  isBusy: boolean;
  onSelect: (action: RewriteAction) => void;
  onOpenLanguages: () => void;
  isLanguageOpen: boolean;
}

const TABS: readonly RewriteAction[] = ['improve', 'translate'];

/**
 * The card's two modes.
 *
 * Replaces the adjust drawer: with the right-click menu gone, this is the only
 * way to reach Translate, and the shortcut reopens whichever tab was used last.
 * The gear belongs to Translate alone — a language picker means nothing on the
 * Rewrite tab, and showing it there would be a control that does nothing.
 */
export function CardTabs({
  action,
  language,
  isBusy,
  onSelect,
  onOpenLanguages,
  isLanguageOpen,
}: CardTabsProps) {
  return (
    <div className="card__tablist" role="tablist" aria-label="Mode">
      {TABS.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          className="card__tab"
          aria-selected={action === id}
          // Roving tabIndex: the selected tab is the tablist's single tab stop,
          // and the arrow keys move between them.
          tabIndex={action === id ? 0 : -1}
          onClick={() => onSelect(id)}
        >
          {getAction(id).label}

          {id === 'translate' && action === 'translate' && (
            <span
              className="card__tab-gear"
              role="button"
              tabIndex={0}
              aria-label={`Language: ${language}. Choose another`}
              aria-expanded={isLanguageOpen}
              onClick={(event) => {
                // Without this the click also selects the tab and re-runs the
                // translation behind the picker that just opened.
                event.stopPropagation();
                onOpenLanguages();
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.stopPropagation();
                onOpenLanguages();
              }}
            >
              <GearIcon />
            </span>
          )}
        </button>
      ))}

      {isBusy && <span className="sr-only">Working…</span>}
    </div>
  );
}
