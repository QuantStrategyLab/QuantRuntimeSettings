import { useLanguage, useT } from "../i18n";
import type { CalendarCell } from "../api/contracts";
import { formatPercent } from "../lib/format";
import { usePrefs } from "../app/context";

const WEEKDAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const WEEKDAY_ZH: Record<string, string> = {
  Mon: "一", Tue: "二", Wed: "三", Thu: "四", Fri: "五", Sat: "六", Sun: "日",
};

function cellColor(cell: CalendarCell, maxAbs: number): string | undefined {
  if (cell.return_percent === null || !Number.isFinite(cell.return_percent) || maxAbs <= 0) return undefined;
  const intensity = Math.min(1, Math.abs(cell.return_percent) / maxAbs);
  const alpha = 8 + Math.round(intensity * 40);
  return `color-mix(in srgb, var(--${cell.return_percent > 0 ? "up" : "down"}) ${alpha}%, transparent)`;
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
  const maxAbs = Math.max(0, ...cells.map(cell => (cell.return_percent !== null && Number.isFinite(cell.return_percent) ? Math.abs(cell.return_percent) : 0)));
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const currentMonth = today.slice(0, 7);

  const valueText = (cell: CalendarCell): string => {
    if (cell.return_percent !== null && Number.isFinite(cell.return_percent)) return formatPercent(cell.return_percent, language);
    if (cell.amount !== null && Number.isFinite(cell.amount)) return prefs.hideAmounts ? "•••" : String(Math.round(cell.amount));
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
          {cells.map(cell => (
            <button
              key={cell.month}
              type="button"
              className={`calendar-cell${cell.month && cell.month > currentMonth ? " cell-future" : ""}${cell.return_percent === null && cell.amount === null ? " cell-empty" : ""}`}
              style={{ background: cell.month && cell.month > currentMonth ? undefined : cellColor(cell, maxAbs) }}
              title={cell.month && cell.month > currentMonth ? undefined : cell.unavailable_reason ? t(`reason.${cell.unavailable_reason}`) : undefined}
              onClick={() => cell.month && onNavigate(year, Number(cell.month.split("-")[1]))}
            >
              <span className="cell-date">{cell.month}</span>
              <span className={`cell-value ${cell.return_percent !== null ? (cell.return_percent > 0 ? "up" : cell.return_percent < 0 ? "down" : "flat") : ""}`}>
                {valueText(cell) || " "}
              </span>
            </button>
          ))}
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
            // Future days stay neutral: no observed value and no missing-history claim.
            const future = Boolean(cell.date && cell.date > today);
            const hasValue = !future && (cell.return_percent !== null || cell.amount !== null);
            // Only explicit producer states mark a closed day. Missing prices or
            // an empty weekend never infer a holiday, so 7×24 crypto calendars
            // keep real history gaps visible. The wire may carry a closed status
            // beyond today's narrower contract union.
            const wireStatus = String(cell.status);
            const wireReason = cell.unavailable_reason as string | null;
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
                  <span className={`cell-value ${cell.return_percent !== null ? (cell.return_percent > 0 ? "up" : cell.return_percent < 0 ? "down" : "flat") : ""}`}>
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
