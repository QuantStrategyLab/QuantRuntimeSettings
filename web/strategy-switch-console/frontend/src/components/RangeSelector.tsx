import { useT } from "../i18n";
import type { Range } from "../api/contracts";

export const RANGES: Range[] = ["1M", "3M", "YTD", "1Y", "ALL"];

/** Range buttons; optional per-range return figures sit under each button (— when history is short). */
export function RangeSelector({ value, onChange, returns }: { value: Range; onChange: (range: Range) => void; returns?: Partial<Record<Range, string | null>> }) {
  const t = useT();
  return (
    <div className="segmented" role="group" aria-label={t("perf.calendar_title") /* group label overridden below */}>
      {RANGES.map(range => (
        <button
          key={range}
          type="button"
          className={`segment${range === value ? " active" : ""}`}
          aria-pressed={range === value}
          onClick={() => onChange(range)}
        >
          <span>{t(`perf.range.${range}` as const)}</span>
          {returns && <span className="segment-sub">{returns[range] ?? "—"}</span>}
        </button>
      ))}
    </div>
  );
}
