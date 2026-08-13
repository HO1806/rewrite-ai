/**
 * Tone / format / length adjustments.
 *
 * The three option groups and their three selection handlers were previously
 * written out three times each — near-identical `.map()` bodies and three
 * copies of the same toggle function, differing only in which key they touched.
 * One generic handler and one pill list now cover all three.
 */

import { useId, useState } from 'react';
import type { AdjustParams } from '@/shared/types';
import { AdjustCategory, CATEGORY_TABS } from './adjustCategories';

interface AdjustDrawerProps {
  params: AdjustParams;
  isDisabled: boolean;
  onChange: (params: AdjustParams) => void;
}

export function AdjustDrawer({
  params,
  isDisabled,
  onChange,
}: AdjustDrawerProps) {
  const [activeKey, setActiveKey] = useState<AdjustCategory>('tone');
  const idPrefix = useId();

  const activeTab =
    CATEGORY_TABS.find((tab) => tab.key === activeKey) ?? CATEGORY_TABS[0]!;

  /** Selecting the current value clears it, so a choice can be undone. */
  const select = (key: AdjustCategory, value: string) => {
    onChange({ ...params, [key]: params[key] === value ? undefined : value });
  };

  const moveFocus = (offset: number) => {
    const index = CATEGORY_TABS.findIndex((tab) => tab.key === activeKey);
    const next =
      CATEGORY_TABS[
        (index + offset + CATEGORY_TABS.length) % CATEGORY_TABS.length
      ];
    if (next) setActiveKey(next.key);
  };

  return (
    <div className="card__drawer">
      <div
        className="card__tablist"
        role="tablist"
        aria-label="Adjust the rewrite"
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') moveFocus(1);
          else if (event.key === 'ArrowLeft') moveFocus(-1);
          else return;
          event.preventDefault();
        }}
      >
        {CATEGORY_TABS.map((tab) => {
          const isActive = tab.key === activeKey;
          const selectedValue = params[tab.key];

          return (
            <button
              type="button"
              key={tab.key}
              id={`${idPrefix}-tab-${tab.key}`}
              className="card__tab"
              role="tab"
              aria-selected={isActive}
              aria-controls={`${idPrefix}-panel-${tab.key}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveKey(tab.key)}
            >
              <span aria-hidden="true">{tab.icon}</span>
              <span>{tab.label}</span>
              {selectedValue && (
                <>
                  <span className="card__tab-dot" aria-hidden="true" />
                  {/* The dot alone conveys nothing without sight. */}
                  <span className="sr-only">, set to {selectedValue}</span>
                </>
              )}
            </button>
          );
        })}
      </div>

      <div
        className="card__pills"
        id={`${idPrefix}-panel-${activeTab.key}`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-tab-${activeTab.key}`}
      >
        {activeTab.options.map((option) => {
          const isSelected = params[activeTab.key] === option.value;

          return (
            <button
              type="button"
              key={option.value}
              className="card__pill"
              aria-pressed={isSelected}
              disabled={isDisabled}
              onClick={() => select(activeTab.key, option.value)}
            >
              <span aria-hidden="true">{option.icon}</span>
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
