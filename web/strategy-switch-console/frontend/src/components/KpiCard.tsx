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
  const inner = (
    <>
      <span className="kpi-title">{title}</span>
      <span className="kpi-value num">{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
      {footer && <span className="kpi-foot">{footer}</span>}
    </>
  );
  if (onClick) {
    return <button type="button" className="kpi-card" onClick={onClick}>{inner}</button>;
  }
  return <div className="kpi-card">{inner}</div>;
}
