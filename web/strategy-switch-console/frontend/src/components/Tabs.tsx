import type { ReactNode } from "react";

export interface TabItem {
  id: string;
  label: ReactNode;
}

export function Tabs({ items, active, onChange, ariaLabel }: { items: TabItem[]; active: string; onChange: (id: string) => void; ariaLabel?: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === active}
          className={`tab${item.id === active ? " active" : ""}`}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
