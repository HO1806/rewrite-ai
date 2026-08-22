import { useRef } from 'react';
import { getAction } from '@/shared/constants';
import type { RewriteAction } from '@/shared/types';
import { GearIcon } from './icons';

interface CardTabsProps {
  action: RewriteAction;
  language: string;
  onSelect: (action: RewriteAction) => void;
  onOpenLanguages: () => void;
  isLanguageOpen: boolean;
  /** So the card can put focus back on the gear when the picker closes. */
  gearRef: React.RefObject<HTMLButtonElement>;
}

const TABS: readonly RewriteAction[] = ['improve', 'translate'];

/**
 * The card's two modes.
 *
 * Replaces the adjust drawer: with the right-click menu gone, this is the only
 * way to reach Translate.
 *
 * Two things here are load-bearing for a keyboard user, and both were wrong in
 * the first version. **Arrow keys must move between tabs**, because roving
 * `tabIndex` puts `-1` on the inactive tab — without a key handler that tab is
 * unreachable by keyboard entirely, which on an extension whose only entry point
 * is a keyboard shortcut meant Translate could be reached by mouse alone. And
 * **the gear is a sibling of the tablist, not a child of a tab**: interactive
 * content nested inside a `<button>` is invalid HTML, and it leaked its own
 * label into the tab's accessible name.
 */
export function CardTabs({
  action,
  language,
  onSelect,
  onOpenLanguages,
  isLanguageOpen,
  gearRef,
}: CardTabsProps) {
  const tabRefs = useRef(new Map<RewriteAction, HTMLButtonElement>());

  /** APG tabs, automatic activation: moving focus also selects. */
  const handleKeyDown = (event: React.KeyboardEvent) => {
    const index = TABS.indexOf(action);
    const next =
      event.key === 'ArrowRight'
        ? TABS[(index + 1) % TABS.length]
        : event.key === 'ArrowLeft'
          ? TABS[(index - 1 + TABS.length) % TABS.length]
          : event.key === 'Home'
            ? TABS[0]
            : event.key === 'End'
              ? TABS[TABS.length - 1]
              : undefined;

    if (!next) return;

    // The host page must not also act on the arrow key, for the same reason the
    // card's Escape and Ctrl+Enter handlers stop propagation.
    event.preventDefault();
    event.stopPropagation();

    onSelect(next);
    tabRefs.current.get(next)?.focus();
  };

  return (
    <div className="card__tabrow">
      <div
        className="card__tablist"
        role="tablist"
        aria-label="Mode"
        onKeyDown={handleKeyDown}
      >
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            className="card__tab"
            aria-selected={action === id}
            // Roving tabIndex: the selected tab is the tablist's single tab
            // stop, and `handleKeyDown` above moves between them.
            tabIndex={action === id ? 0 : -1}
            ref={(node) => {
              if (node) tabRefs.current.set(id, node);
              else tabRefs.current.delete(id);
            }}
            onClick={() => onSelect(id)}
          >
            {getAction(id).label}
          </button>
        ))}
      </div>

      {action === 'translate' && (
        <button
          ref={gearRef}
          type="button"
          className="card__tab-gear"
          aria-label={`Language: ${language}. Choose another`}
          aria-expanded={isLanguageOpen}
          onClick={onOpenLanguages}
        >
          <GearIcon />
        </button>
      )}
    </div>
  );
}
