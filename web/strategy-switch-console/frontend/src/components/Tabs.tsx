import type { ReactNode } from "react";

export interface TabItem {
  id: string;
  label: ReactNode;
}

export function Tabs({ id, items, active, onChange, ariaLabel }: { id: string; items: TabItem[]; active: string; onChange: (id: string) => void; ariaLabel?: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          role="tab"
          id={`${id}-tab-${item.id}`}
          aria-controls={`${id}-panel`}
          aria-selected={item.id === active}
          tabIndex={item.id === active ? 0 : -1}
          className={`tab${item.id === active ? " active" : ""}`}
          onClick={() => onChange(item.id)}
          onKeyDown={event => {
            const index = items.findIndex(tab => tab.id === item.id);
            const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
              : event.key === "ArrowRight" ? (index + 1) % items.length
              : event.key === "ArrowLeft" ? (index - 1 + items.length) % items.length : null;
            if (next === null) return;
            event.preventDefault();
            const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
            buttons?.[next]?.focus();
            onChange(items[next].id);
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
