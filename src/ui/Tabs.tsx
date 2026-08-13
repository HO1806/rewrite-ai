/**
 * An accessible tab bar.
 *
 * Replaces three copy-pasted <button>s carrying identical twelve-property style
 * objects, with no tablist semantics and no keyboard navigation.
 */

import type { ReactNode } from 'react';

export interface TabDefinition<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly icon?: string;
  readonly render: () => ReactNode;
}

interface TabsProps<T extends string> {
  tabs: readonly TabDefinition<T>[];
  activeId: T;
  onChange: (id: T) => void;
  label: string;
}

export function Tabs<T extends string>({
  tabs,
  activeId,
  onChange,
  label,
}: TabsProps<T>) {
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  if (!activeTab) return null;

  const move = (offset: number) => {
    const index = tabs.findIndex((tab) => tab.id === activeId);
    const next = tabs[(index + offset + tabs.length) % tabs.length];
    if (next) onChange(next.id);
  };

  return (
    <>
      <div
        className="tablist"
        role="tablist"
        aria-label={label}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') move(1);
          else if (event.key === 'ArrowLeft') move(-1);
          else return;
          event.preventDefault();
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <button
              type="button"
              key={tab.id}
              id={`tab-${tab.id}`}
              className="tab"
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChange(tab.id)}
            >
              {tab.icon && <span aria-hidden="true">{tab.icon} </span>}
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        id={`panel-${activeTab.id}`}
        role="tabpanel"
        aria-labelledby={`tab-${activeTab.id}`}
      >
        {activeTab.render()}
      </div>
    </>
  );
}
