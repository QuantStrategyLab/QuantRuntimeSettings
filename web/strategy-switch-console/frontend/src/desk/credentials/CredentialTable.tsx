/**
 * Credentials table (Meridian frame C2/C3/C5): one dense, urgency-ordered row per
 * credential, the legend that explains the three expiry states, and the summary chips.
 * Expiry order comes from credentials/table.ts, never from fixture order.
 *
 * Above 1100 px this renders as a table; below it the very same rows re-flow into
 * one card per credential, because even a tablet-width table overflows horizontally.
 * That card layout is applied inline from useNarrow, so
 * the cells keep their explicit table/row/cell roles and carry their own column label.
 */
import type { CSSProperties, ReactNode } from "react";
import type { Language } from "../../lib/prefs";
import type { CredentialItem } from "../contract/types";
import { credentialExpiryView, formatCredentialAt, phaseLabel } from "./model.ts";
import type { CredentialSummary } from "./table.ts";
import { credentialAction, sortCredentials } from "./table.ts";
import type { DeskKey, DeskTranslate } from "../i18n/index.ts";
import { useNarrow } from "../components/useNarrow.ts";
import { P } from "../components/deskStyles.ts";

const COLUMNS = ["broker", "credential", "expiry", "phase", "rotated", "action"] as const;
type CredentialColumn = (typeof COLUMNS)[number];

const chipTone = { due: "warn", known: "ok", none: "ok", unknown: "unknown" } as const;

/* Card layout for the same table rows below the 1100 px breakpoint, kept inline so
   the responsive styles travel with the component instead of growing desk.css. The roles stay untouched. */
const mobileTable: CSSProperties = { display: "block" };
const mobileRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)",
  gridTemplateAreas: `"b e" "c e" "p r" "a a"`,
  gap: "8px 12px",
  marginBottom: 10,
  padding: "12px 14px",
  border: "1px solid var(--mrd-line)",
  borderRadius: 14,
  background: "var(--mrd-panel-2)",
};
const mobileCell: CSSProperties = { display: "flex", flexDirection: "column", gap: 2, minWidth: 0, padding: 0, border: 0 };
const gridArea: Record<CredentialColumn, CSSProperties> = {
  broker: { gridArea: "b" },
  credential: { gridArea: "c" },
  expiry: { gridArea: "e" },
  phase: { gridArea: "p" },
  rotated: { gridArea: "r" },
  action: { gridArea: "a" },
};
const cellLabel = (zh: boolean): CSSProperties => ({
  display: "block",
  color: "var(--mrd-ink-3)",
  font: "500 10px var(--font-sans)",
  letterSpacing: zh ? "0.04em" : "0.08em",
  textTransform: "uppercase",
});

export function CredentialSummaryChips({ summary, t }: { summary: CredentialSummary; t: DeskTranslate }) {
  const chips = [
    { key: "due", tone: chipTone.due, value: summary.due },
    { key: "known", tone: chipTone.known, value: summary.known },
    { key: "none", tone: chipTone.none, value: summary.none },
    { key: "unknown", tone: chipTone.unknown, value: summary.unknown },
  ] as const;
  return (
    <div style={P.chips} role="group" aria-label={t("credentials.table.title")}>
      {chips.map(chip => (
        <span key={chip.key} className="mrd-chip" data-tone={chip.tone} data-summary={chip.key}>
          {t(`credentials.chip.${chip.key}` as DeskKey, { count: chip.value })}
        </span>
      ))}
    </div>
  );
}

function rowUrgency(item: CredentialItem): "expired" | "due" | "unknown" | "calm" {
  if (item.expiry.status === "unknown") return "unknown";
  return item.phase === "expired" ? "expired" : item.phase === "7" || item.phase === "1" ? "due" : "calm";
}

function Action({ item, t }: { item: CredentialItem; t: DeskTranslate }) {
  const action = credentialAction(item);
  if (action.kind === "rotate") {
    return (
      <div style={P.column}>
        <a className="mrd-chip" href={item.rotation.route ?? undefined} data-credential-action="rotate">{t(action.label)}</a>
        {item.runbook ? (
          <a className="mrd-chip" href={item.runbook} target="_blank" rel="noopener noreferrer" data-credential-action="runbook">{t("credentials.action.runbook")}</a>
        ) : null}
      </div>
    );
  }
  // The reason is a field code, not copy: it is shown exactly as the contract spells it.
  const reason = action.reason === "nothing_to_rotate" ? "expiry.status=none" : "rotation.supported=false";
  return (
    <div style={P.column}>
      <button type="button" className="mrd-chip" disabled title={reason} data-credential-action={action.reason}>
        {t(action.reason === "nothing_to_rotate" ? "credentials.action.nothing" : "credentials.action.no_route")}
      </button>
      <span className="mrd-why">{reason}</span>
    </div>
  );
}

function Cell({ column, t, narrow, zh, style, children }: {
  column: CredentialColumn;
  t: DeskTranslate;
  narrow: boolean;
  zh: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <td role="cell" data-col={column} style={narrow ? { ...mobileCell, ...gridArea[column], ...style } : style}>
      <span className="mrd-cell-label" style={narrow ? cellLabel(zh) : { display: "none" }}>{t(`credentials.col.${column}` as DeskKey)}</span>
      {children}
    </td>
  );
}

export function CredentialTable({ items, generatedAt, t, language }: {
  items: readonly CredentialItem[];
  /** The read's own server instant: day counts never come from the browser clock. */
  generatedAt: string;
  t: DeskTranslate;
  language: Language;
}) {
  const narrow = useNarrow(1100);
  const zh = language === "zh";
  return (
    <div style={narrow ? { ...P.tableWrap, overflowX: "visible" } : P.tableWrap}>
      <table className="mrd-table" role="table" style={narrow ? mobileTable : undefined}>
        <caption style={P.sr}>{t("credentials.table.title")}</caption>
        <thead role="rowgroup" style={narrow ? { display: "none" } : undefined}>
          <tr role="row">
            {COLUMNS.map(head => (
              <th key={head} role="columnheader" scope="col">{t(`credentials.col.${head}` as DeskKey)}</th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup" style={narrow ? { display: "block" } : undefined}>
          {sortCredentials(items).map(item => {
            const view = credentialExpiryView(item.expiry, item.phase, t, language);
            const urgency = rowUrgency(item);
            const rotated = item.last_rotated_at ? formatCredentialAt(item.last_rotated_at, language) : null;
            const days = item.expiry.status === "known" ? daysLeft(item.expiry.at, generatedAt) : null;
            const tint = urgency === "calm" ? undefined : P.tint(urgency);
            const rowStyle: CSSProperties | undefined = narrow ? { ...mobileRow, ...tint } : tint;
            return (
              <tr key={item.id} role="row" style={rowStyle} data-credential-id={item.id} data-credential-phase={view.phase} data-urgency={urgency}>
                <Cell column="broker" t={t} narrow={narrow} zh={zh}>
                  <b style={{ fontSize: 13 }}>{item.label}</b>
                  <small>{item.platform}</small>
                </Cell>
                <Cell column="credential" t={t} narrow={narrow} zh={zh}>
                  <span>{t(`credential.kind.${item.kind}` as DeskKey)}</span>
                  <small>{item.kind}</small>
                </Cell>
                <Cell column="expiry" t={t} narrow={narrow} zh={zh} style={P.mark(view.tone)}>
                  <b style={narrow ? { fontSize: 15, lineHeight: 1.3, overflowWrap: "anywhere" } : undefined}>{view.mark}</b>
                  <small style={narrow ? { fontSize: 11 } : undefined}>{days === null ? view.detail : `${view.detail} · ${t("credentials.days_left", { days })}`}</small>
                </Cell>
                <Cell column="phase" t={t} narrow={narrow} zh={zh}><span style={P.badge(view.tone)}>{phaseLabel(view.phase, t)}</span></Cell>
                <Cell column="rotated" t={t} narrow={narrow} zh={zh} style={{ fontSize: 12 }}>{rotated ?? t("credentials.list.never_rotated")}</Cell>
                <Cell column="action" t={t} narrow={narrow} zh={zh}><Action item={item} t={t} /></Cell>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Whole days left between the read instant and the expiry; null when either is unusable or spent. */
export function daysLeft(at: string, readAt: string): number | null {
  const expiry = Date.parse(at);
  const read = Date.parse(readAt);
  if (!Number.isFinite(expiry) || !Number.isFinite(read)) return null;
  const days = Math.floor((expiry - read) / 86_400_000);
  return days > 0 ? days : null;
}

export function CredentialLegend({ t }: { t: DeskTranslate }) {
  const entries = [
    { id: "known", tone: "ok" as const },
    { id: "none", tone: "ok" as const },
    { id: "unknown", tone: "unknown" as const },
  ];
  return (
    <div style={P.legendGrid} data-legend="expiry">
      {entries.map(entry => (
        <div key={entry.id} style={P.card} data-legend-state={entry.id}>
          <span style={{ ...P.badge(entry.tone), alignSelf: "flex-start" }}>{t(`credentials.legend.${entry.id}.title` as DeskKey)}</span>
          <p style={P.muted}>{t(`credentials.legend.${entry.id}.body` as DeskKey)}</p>
        </div>
      ))}
    </div>
  );
}
