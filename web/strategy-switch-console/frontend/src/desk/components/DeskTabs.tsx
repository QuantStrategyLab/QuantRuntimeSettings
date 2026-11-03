import { useRef } from "react";
import type { CSSProperties } from "react";

export interface DeskTabItem {
  id: string;
  label: string;
}

const strip: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  padding: 4,
  borderRadius: 99,
  background: "var(--mrd-panel)",
  border: "1px solid var(--mrd-line)",
  alignSelf: "flex-start",
};

const tab = (active: boolean): CSSProperties => ({
  padding: "7px 16px",
  border: 0,
  borderRadius: 99,
  background: active ? "var(--mrd-panel-2)" : "none",
  boxShadow: active ? "inset 0 0 0 1px var(--mrd-line)" : "none",
  color: active ? "var(--mrd-ink)" : "var(--mrd-ink-3)",
  font: "500 13px var(--font-sans)",
  cursor: "pointer",
});

/** Accessible sub-tabs for the desk; arrow keys move focus and selection together. */
export function DeskTabs({ id, items, active, onChange, label }: {
  id: string;
  items: readonly DeskTabItem[];
  active: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  return (
    <div className="mrd-tabs" role="tablist" aria-label={label} ref={listRef} style={strip}>
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          role="tab"
          id={`${id}-tab-${item.id}`}
          aria-controls={`${id}-panel`}
          aria-selected={item.id === active}
          tabIndex={item.id === active ? 0 : -1}
          style={tab(item.id === active)}
          onClick={() => onChange(item.id)}
          onKeyDown={event => {
            const index = items.findIndex(entry => entry.id === item.id);
            const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
              : event.key === "ArrowRight" ? (index + 1) % items.length
              : event.key === "ArrowLeft" ? (index - 1 + items.length) % items.length : null;
            if (next === null) return;
            event.preventDefault();
            const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
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
