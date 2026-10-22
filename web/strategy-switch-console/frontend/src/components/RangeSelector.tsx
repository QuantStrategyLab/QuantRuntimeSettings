import { useT } from "../i18n";
import type { Range } from "../api/contracts";

export const RANGES: Range[] = ["1M", "3M", "YTD", "1Y", "ALL"];

/** Range buttons; the current range shows its return only when a value exists. */
export function RangeSelector({ value, onChange, returns }: { value: Range; onChange: (range: Range) => void; returns?: Partial<Record<Range, string | null>> }) {
  const t = useT();
  const current = returns?.[value] ?? null;
  return (
    <div className="segmented" role="group" aria-label={t("perf.range.label")}>
      {RANGES.map(range => (
        <button
          key={range}
          type="button"
          className={`segment${range === value ? " active" : ""}`}
          aria-pressed={range === value}
          onClick={() => onChange(range)}
        >
          <span>{t(`perf.range.${range}` as const)}</span>
          {range === value && current && <span className="segment-sub">{current}</span>}
        </button>
      ))}
    </div>
  );
}
