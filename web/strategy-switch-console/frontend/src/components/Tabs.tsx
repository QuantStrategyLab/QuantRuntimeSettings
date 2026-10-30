import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export interface TabItem {
  id: string;
  label: ReactNode;
}

/**
 * How far the strip must scroll to bring the selected tab fully into its own
 * viewport. `tabLeft` is measured against the strip itself, never offsetLeft:
 * `.tabs` is not a positioned ancestor, so offsetLeft would be relative to
 * whatever positioned element happens to wrap it and the comparison with
 * scrollLeft would be meaningless. A tab wider than the strip aligns its left
 * edge instead of chasing the right one.
 */
export function revealDelta(tabLeft: number, tabWidth: number, viewportWidth: number): number {
  if (tabWidth >= viewportWidth) return tabLeft;
  const right = tabLeft + tabWidth;
  if (tabLeft < 0) return tabLeft;
  if (right > viewportWidth) return right - viewportWidth;
  return 0;
}

export function Tabs({ id, items, active, onChange, ariaLabel }: { id: string; items: TabItem[]; active: string; onChange: (id: string) => void; ariaLabel?: string }) {
  const listRef = useRef<HTMLDivElement>(null);

  // A scrolled tab strip keeps the selected tab in view. Only the strip moves,
  // so the page itself never jumps.
  useEffect(() => {
    const list = listRef.current;
    if (!list || list.scrollWidth <= list.clientWidth) return;
    const current = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!current) return;
    const strip = list.getBoundingClientRect();
    const tab = current.getBoundingClientRect();
    const delta = revealDelta(tab.left - strip.left, tab.width, list.clientWidth);
    if (delta !== 0) list.scrollLeft = Math.max(0, list.scrollLeft + delta);
  }, [active]);

  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel} ref={listRef}>
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
