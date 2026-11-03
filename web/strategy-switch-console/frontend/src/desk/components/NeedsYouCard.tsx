import type { CSSProperties } from "react";
import type { NeedsYouItem } from "../contract/types";
import type { DeskKey, DeskTranslate } from "../i18n/index.ts";
import { P } from "./deskStyles.ts";
import { deskRoute } from "./stateModel.ts";

const list: CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 };
const item: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px", borderRadius: 14, border: "1px solid var(--mrd-line)" };

export function NeedsYouCard({ items, t }: { items: readonly NeedsYouItem[]; t: DeskTranslate }) {
  return (
    <section className="mrd-card" style={P.column} aria-labelledby="mrd-needs-title" data-needs-count={items.length}>
      <span className="mrd-label" id="mrd-needs-title">{t("overview.needs.title")}</span>
      {items.length === 0 ? (
        <p style={P.muted}>{t("overview.needs.empty")}</p>
      ) : (
        <ul style={list}>
          {items.map(entry => (
            <li key={entry.id} style={item} data-need-kind={entry.kind} data-severity={entry.severity}>
              <div style={P.rowBetween}>
                <b style={{ fontSize: 13.5 }}>{entry.title}</b>
                <span style={P.badge(entry.severity === "critical" ? "risk" : entry.severity === "warning" ? "warn" : "unknown")}>
                  {t(`severity.${entry.severity}` as DeskKey)}
                </span>
              </div>
              <p style={{ margin: 0, color: "var(--mrd-ink-2)", fontSize: 12.5 }}>{entry.detail}</p>
              <div style={P.actionRow}>
                <a style={P.link} href={deskRoute(entry.action.route)}>{entry.action.label}</a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
