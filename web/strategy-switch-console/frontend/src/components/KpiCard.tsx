import type { ReactNode } from "react";

/** Fixed KPI card structure: title / main value / sub line / status badge + data date / optional details. */
export function KpiCard({
  title,
  value,
  sub,
  footer,
  detail,
  onClick,
  className,
}: {
  title: string;
  value: ReactNode;
  sub?: ReactNode;
  footer?: ReactNode;
  /** Collapsible specifics; rendered only on non-navigating cards, never inside a button. */
  detail?: ReactNode;
  onClick?: () => void;
  /** Layout hook for the owning page (e.g. a card that needs its own row on narrow screens). */
  className?: string;
}) {
  // Block values (native-currency totals) need a div; keep spans when the card
  // itself is a button, since a button cannot contain flow content.
  const inner = (ValueTag: "div" | "span") => (
    <>
      <span className="kpi-title">{title}</span>
      <ValueTag className="kpi-value num">{value}</ValueTag>
      {sub && <span className="kpi-sub">{sub}</span>}
      {footer && <span className="kpi-foot">{footer}</span>}
    </>
  );
  const classes = className ? `kpi-card ${className}` : "kpi-card";
  if (onClick) {
    return <button type="button" className={classes} onClick={onClick}>{inner("span")}</button>;
  }
  return <div className={classes}>{inner("div")}{detail}</div>;
}
