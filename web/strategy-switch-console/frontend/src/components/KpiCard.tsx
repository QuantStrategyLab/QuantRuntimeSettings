import type { ReactNode } from "react";

/** Fixed KPI card structure: title / main value / sub line / status badge + data date. */
export function KpiCard({
  title,
  value,
  sub,
  footer,
  onClick,
}: {
  title: string;
  value: ReactNode;
  sub?: ReactNode;
  footer?: ReactNode;
  onClick?: () => void;
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
  if (onClick) {
    return <button type="button" className="kpi-card" onClick={onClick}>{inner("span")}</button>;
  }
  return <div className="kpi-card">{inner("div")}</div>;
}
