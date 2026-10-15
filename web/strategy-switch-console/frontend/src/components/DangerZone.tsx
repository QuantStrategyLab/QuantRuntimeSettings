import type { ReactNode } from "react";
import { useT } from "../i18n";

/** Red-outlined card for run-control actions; each row is description + consequence + button. */
export function DangerZone({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <section className="danger-zone" aria-label={t("controls.title")}>
      <h3 className="danger-zone-title">{t("controls.title")}</h3>
      <p className="card-note" style={{ margin: 0 }}>{t("controls.danger_note")}</p>
      {children}
    </section>
  );
}

export function DangerRow({ title, summary, action, unavailableReason }: { title: string; summary: string; action: ReactNode; unavailableReason?: string | null }) {
  const t = useT();
  return (
    <div className="danger-row">
      <div className="danger-row-text">
        <strong>{title}</strong>
        <p>{summary}</p>
        {unavailableReason && <p>{t("controls.unavailable", { reason: unavailableReason })}</p>}
      </div>
      <div>{action}</div>
    </div>
  );
}
