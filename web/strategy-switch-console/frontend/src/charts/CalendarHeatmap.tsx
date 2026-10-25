import { useLanguage, useT } from "../i18n";
import type { CalendarCell } from "../api/contracts";
import { formatPercent } from "../lib/format";
import { usePrefs } from "../app/context";

const WEEKDAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const WEEKDAY_ZH: Record<string, string> = {
  Mon: "一", Tue: "二", Wed: "三", Thu: "四", Fri: "五", Sat: "六", Sun: "日",
};

/** Only a finite number is a real observation; null, undefined and NaN stay blank. */
function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 0% is neutral; missing or non-finite values have no up/down/flat tone at all. */
function cellTone(cell: CalendarCell): "up" | "down" | "flat" | "" {
  const value = finiteNumber(cell.return_percent);
  return value === null ? "" : value > 0 ? "up" : value < 0 ? "down" : "flat";
}

function cellColor(cell: CalendarCell, maxAbs: number): string | undefined {
  const value = finiteNumber(cell.return_percent);
  if (value === null || value === 0 || maxAbs <= 0) return undefined;
  const intensity = Math.min(1, Math.abs(value) / maxAbs);
  const alpha = 8 + Math.round(intensity * 40);
  return `color-mix(in srgb, var(--${value > 0 ? "up" : "down"}) ${alpha}%, transparent)`;
}

/**
 * Return calendar. Month view: all seven natural days are laid out; a day with
 * no record stays blank rather than being hidden or assumed closed. Year view:
 * 12 monthly cells.
 */
export function CalendarHeatmap({
  year,
  month,
  cells,
  onNavigate,
}: {
  year: number;
  month: number | null;
  cells: CalendarCell[];
  onNavigate: (year: number, month: number | null) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const { prefs } = usePrefs();
  const maxAbs = Math.max(0, ...cells.map(cell => {
    const value = finiteNumber(cell.return_percent);
    return value === null ? 0 : Math.abs(value);
  }));
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const currentMonth = today.slice(0, 7);

  const valueText = (cell: CalendarCell): string => {
    const percent = finiteNumber(cell.return_percent);
    if (percent !== null) return formatPercent(percent, language);
    const amount = finiteNumber(cell.amount);
    if (amount !== null) return prefs.hideAmounts ? "•••" : String(Math.round(amount));
    return "";
  };

  if (month === null) {
    return (
      <div>
        <div className="calendar-nav">
          <button type="button" className="button button-secondary button-sm" onClick={() => onNavigate(year - 1, null)} aria-label="‹">‹</button>
          <span className="current num">{year}</span>
          <button type="button" className="button button-secondary button-sm" onClick={() => onNavigate(year + 1, null)} aria-label="›">›</button>
        </div>
        <div className="calendar-year-grid" style={{ marginTop: 12 }}>
          {cells.map(cell => {
            // The producer's explicit future_date wins over the local-clock
            // comparison, so timezone or month-boundary skew cannot turn a
            // future month into a missing-history claim. The date comparison
            // stays as a fallback for older payloads without the reason.
            const wireReason = cell.unavailable_reason as string | null;
            const future = Boolean(cell.month && cell.month > currentMonth) || wireReason === "future_date";
            return (
            <button
              key={cell.month}
              type="button"
              className={`calendar-cell${future ? " cell-future" : ""}${finiteNumber(cell.return_percent) === null && finiteNumber(cell.amount) === null ? " cell-empty" : ""}`}
              style={{ background: future ? undefined : cellColor(cell, maxAbs) }}
              title={future || !cell.unavailable_reason ? undefined : t(`reason.${cell.unavailable_reason}`)}
              onClick={() => cell.month && onNavigate(year, Number(cell.month.split("-")[1]))}
            >
              <span className="cell-date">{cell.month}</span>
              <span className={`cell-value ${future ? "" : cellTone(cell)}`}>
                {future ? " " : valueText(cell) || " "}
              </span>
            </button>
            );
          })}
        </div>
      </div>
    );
  }

  const byDate = new Map(cells.filter(cell => cell.date).map(cell => [cell.date!, cell]));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weeks: (CalendarCell | null)[][] = [];
  let week: (CalendarCell | null)[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const column = (weekday + 6) % 7; // Monday-first natural week, weekends included
    if (column === 0 && week.length) {
      weeks.push(week);
      week = [];
    }
    while (week.length < column) week.push(null);
    week.push(byDate.get(date) || { date, amount: null, return_percent: null, currency: null, status: "no_data", value_kind: "asset_change", unavailable_reason: null });
  }
  if (week.length) weeks.push(week);

  return (
    <div>
      <div className="calendar-nav">
        <button type="button" className="button button-secondary button-sm" onClick={() => onNavigate(...(month === 1 ? [year - 1, 12] : [year, month - 1]) as [number, number])} aria-label="‹">‹</button>
        <button type="button" className="current button button-sm" onClick={() => onNavigate(year, null)} aria-label={t("perf.calendar_year")}>
          {year}-{String(month).padStart(2, "0")}
        </button>
        <button type="button" className="button button-secondary button-sm" onClick={() => onNavigate(...(month === 12 ? [year + 1, 1] : [year, month + 1]) as [number, number])} aria-label="›">›</button>
      </div>
      <div className="calendar-month-grid" style={{ marginTop: 12 }}>
        {WEEKDAY_KEYS.map(day => (
          <div key={day} className="calendar-weekday">{language === "zh" ? WEEKDAY_ZH[day] : day}</div>
        ))}
        {weeks.flatMap((row, weekIndex) =>
          [0, 1, 2, 3, 4, 5, 6].map(column => {
            const cell = row[column];
            if (!cell) return <div key={`${weekIndex}-${column}`} />;
            const wireStatus = String(cell.status);
            const wireReason = cell.unavailable_reason as string | null;
            // Future days stay neutral: the producer's explicit future_date
            // wins over the local-clock comparison, which remains only as a
            // fallback for older payloads without the reason.
            const future = Boolean(cell.date && cell.date > today) || wireReason === "future_date";
            const hasValue = !future && (finiteNumber(cell.return_percent) !== null || finiteNumber(cell.amount) !== null);
            // Only explicit producer states mark a closed day. Missing prices or
            // an empty weekend never infer a holiday, so 7×24 crypto calendars
            // keep real history gaps visible. The wire may carry a closed status
            // beyond today's narrower contract union.
            const closed = !future && (wireStatus === "market_closed"
              || wireReason === "market_closed" || wireReason === "non_trading_weekend");
            const title = future ? undefined
              : wireStatus === "market_closed" || wireReason === "market_closed" ? t("state.market_closed")
              : wireReason === "non_trading_weekend" ? t("reason.non_trading_weekend")
              : cell.unavailable_reason ? t(`reason.${cell.unavailable_reason}`) : undefined;
            return (
              <div
                key={cell.date}
                className={`calendar-cell${future ? " cell-future" : ""}${closed ? " cell-closed" : ""}${hasValue ? "" : " cell-empty"}`}
                style={{ background: future ? undefined : cellColor(cell, maxAbs) }}
                title={title}
              >
                <span className="cell-date num">{cell.date ? Number(cell.date.slice(8)) : ""}</span>
                {hasValue && (
                  <span className={`cell-value ${cellTone(cell)}`}>
                    {valueText(cell)}
                  </span>
                )}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
