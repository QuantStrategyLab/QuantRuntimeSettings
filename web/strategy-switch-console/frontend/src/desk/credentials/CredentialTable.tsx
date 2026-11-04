/**
 * Credentials table (Meridian frame C2/C3/C5): one dense, urgency-ordered row per
 * credential, the legend that explains the three expiry states, and the summary chips.
 * Expiry order comes from credentials/table.ts, never from fixture order.
 */
import type { Language } from "../../lib/prefs";
import type { CredentialItem } from "../contract/types";
import { credentialExpiryView, formatCredentialAt, phaseLabel } from "./model.ts";
import type { CredentialSummary } from "./table.ts";
import { credentialAction, sortCredentials } from "./table.ts";
import type { DeskKey, DeskTranslate } from "../i18n/index.ts";
import { P } from "../components/deskStyles.ts";

const chipTone = { due: "warn", known: "ok", none: "ok", unknown: "unknown" } as const;

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

export function CredentialTable({ items, generatedAt, t, language }: {
  items: readonly CredentialItem[];
  /** The read's own server instant: day counts never come from the browser clock. */
  generatedAt: string;
  t: DeskTranslate;
  language: Language;
}) {
  return (
    <div style={P.tableWrap}>
      <table className="mrd-table">
        <caption style={P.sr}>{t("credentials.table.title")}</caption>
        <thead>
          <tr>
            {(["broker", "credential", "expiry", "phase", "rotated", "action"] as const).map(head => (
              <th key={head} scope="col">{t(`credentials.col.${head}` as DeskKey)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortCredentials(items).map(item => {
            const view = credentialExpiryView(item.expiry, item.phase, t, language);
            const urgency = rowUrgency(item);
            const rotated = item.last_rotated_at ? formatCredentialAt(item.last_rotated_at, language) : null;
            const days = item.expiry.status === "known" ? daysLeft(item.expiry.at, generatedAt) : null;
            return (
              <tr key={item.id} style={urgency === "calm" ? undefined : P.tint(urgency)} data-credential-id={item.id} data-credential-phase={view.phase} data-urgency={urgency}>
                <td>
                  <b style={{ fontSize: 13 }}>{item.label}</b>
                  <small>{item.platform}</small>
                </td>
                <td>
                  <span>{t(`credential.kind.${item.kind}` as DeskKey)}</span>
                  <small>{item.kind}</small>
                </td>
                <td style={P.mark(view.tone)}>
                  <b>{view.mark}</b>
                  <small>{days === null ? view.detail : `${view.detail} · ${t("credentials.days_left", { days })}`}</small>
                </td>
                <td><span style={P.badge(view.tone)}>{phaseLabel(view.phase, t)}</span></td>
                <td style={{ fontSize: 12 }}>{rotated ?? t("credentials.list.never_rotated")}</td>
                <td><Action item={item} t={t} /></td>
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
