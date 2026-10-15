import { useLanguage } from "../i18n";
import { formatPercent } from "../lib/format";

export interface BarListItem {
  id: string;
  label: string;
  value: number;
}

/** Horizontal diverging bar list (top gainers / losers). */
export function BarList({ items }: { items: BarListItem[] }) {
  const language = useLanguage();
  const maxAbs = Math.max(1e-9, ...items.map(item => Math.abs(item.value)));
  return (
    <div className="barlist">
      {items.map(item => {
        const width = (Math.abs(item.value) / maxAbs) * 50;
        const positive = item.value > 0;
        return (
          <div className="barlist-row" key={item.id}>
            <span className="barlist-label" title={item.label}>{item.label}</span>
            <div className="barlist-track" role="img" aria-label={`${item.label} ${formatPercent(item.value, language)}`}>
              <div
                className="barlist-fill"
                style={{
                  background: positive ? "var(--up)" : "var(--down)",
                  width: `${width}%`,
                  left: positive ? "50%" : `${50 - width}%`,
                }}
              />
            </div>
            <span className={`barlist-value ${positive ? "up" : item.value < 0 ? "down" : "flat"}`}>{formatPercent(item.value, language)}</span>
          </div>
        );
      })}
    </div>
  );
}
