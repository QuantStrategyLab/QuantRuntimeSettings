import { useT } from "../i18n";
import type { Scalar } from "../api/contracts";
import { Badge } from "./primitives";

export interface DiffRowLike {
  field: string;
  label: string;
  before: Scalar;
  after: Scalar;
  affectsLive: boolean;
}

function ScalarText({ value }: { value: Scalar }) {
  const t = useT();
  if (value === null || value === undefined) return <span className="flat">{t("decisions.not_set")}</span>;
  if (typeof value === "boolean") return <>{value ? "✓" : "✕"}</>;
  return <span className="num">{String(value)}</span>;
}

/** Before → after diff table; affects-live rows are called out. */
export function DiffTable({ rows }: { rows: DiffRowLike[] }) {
  const t = useT();
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("decisions.col.field")}</th>
            <th>{t("decisions.col.current")}</th>
            <th>{t("decisions.col.proposed")}</th>
            <th>{t("decisions.col.affects_live")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.field}>
              <td title={row.label !== row.field ? row.field : undefined}>{row.label}</td>
              <td><ScalarText value={row.before} /></td>
              <td><ScalarText value={row.after} /></td>
              <td className={row.affectsLive ? "diff-affects-live" : ""}>
                <Badge tone={row.affectsLive ? "warn" : "unknown"}>
                  {row.affectsLive ? t("decisions.affects_live_required") : t("decisions.affects_live_none")}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
