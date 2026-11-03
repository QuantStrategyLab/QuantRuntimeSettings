import type { Language } from "../../lib/prefs";
import type { DeskResult } from "../api/endpoints.ts";
import type { CredentialItem, Credentials } from "../contract/types";
import { credentialExpiryView, credentialNeeds, formatCredentialAt, phaseLabel } from "../credentials/model.ts";
import type { DeskKey, DeskTranslate } from "../i18n/index.ts";
import { CredentialsReminder } from "../components/CredentialsReminderStrip.tsx";
import { FlexRotationCard } from "../components/FlexRotationCard.tsx";
import { EmptyState, LoadingState, RecoverableErrorState, StalePartialBanner } from "../components/StateBlocks.tsx";
import type { Loadable } from "../components/useDeskLoad.ts";
import { P } from "../components/deskStyles.ts";

function kindLabel(item: CredentialItem, t: DeskTranslate): string {
  return t(`credential.kind.${item.kind}` as DeskKey  );
}
export function CredentialsTab({ load, t, language, reload }: {
  load: Loadable<DeskResult<Credentials>>;
  t: DeskTranslate;
  language: Language;
  reload: () => void;
}) {
  if (load.state === "loading") return <LoadingState t={t} label={t("credentials.title")} startedAt={load.startedAt} onRetry={reload} />;
  if (load.state === "failed") return <RecoverableErrorState t={t} onRetry={reload} />;

  const data = load.result.data;
  const items = data.items;
  if (items.length === 0) return <EmptyState t={t} title={t("credentials.list.empty")} />;

  const included = items.filter(item => item.expiry.status !== "unknown").length;
  const needs = credentialNeeds(items, t, language);

  return (
    <div style={P.page} data-credentials-count={items.length}>
      {included < items.length ? <StalePartialBanner t={t} language={language} included={included} total={items.length} /> : null}
      <section className="mrd-card" style={P.column} aria-labelledby="mrd-credential-reminder">
        <span className="mrd-label" id="mrd-credential-reminder">{t("credentials.reminder.title")}</span>
        <CredentialsReminder items={items} t={t} />
      </section>

      <section className="mrd-card" style={P.column} aria-labelledby="mrd-credential-needs">
        <span className="mrd-label" id="mrd-credential-needs">{t("credentials.list.needs")}</span>
        {needs.length === 0 ? <p style={P.muted}>{t("credentials.list.needs_empty")}</p> : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {needs.map(need => (
              <li key={need.id} data-need-kind={need.kind} style={{ ...P.column, padding: "8px 10px", borderRadius: 12, border: "1px solid var(--mrd-line)" }}>
                <b style={{ fontSize: 13 }}>{need.title}</b>
                <span style={P.muted}>{need.detail}</span>
                <a style={P.link} href={need.action.route}>{need.action.label}</a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mrd-card" style={P.column} aria-labelledby="mrd-credential-list">
        <span className="mrd-label" id="mrd-credential-list">{t("credentials.list.title")}</span>
        <div style={P.grid}>
          {items.map(item => {
            const view = credentialExpiryView(item.expiry, item.phase, t, language);
            const rotated = item.last_rotated_at ? formatCredentialAt(item.last_rotated_at, language) : null;
            return (
              <article key={item.id} style={P.card} data-credential-id={item.id} data-credential-phase={view.phase}>
                <div style={P.cardHead}>
                  <b style={{ fontSize: 14 }}>{item.label}</b>
                  <span style={P.badge(view.tone)}>{phaseLabel(view.phase, t)}</span>
                </div>
                <span style={P.mono}>{item.platform} · {kindLabel(item, t)}</span>
                <div style={P.column}>
                  <span className="mrd-label">{t("credential.expiry.label")}</span>
                  <span style={{ fontSize: 13 }}>{view.mark}</span>
                  <span style={P.muted}>{view.detail}</span>
                </div>
                <div style={P.detailList}>
                  <div style={P.detailItem}>
                    <span style={P.detailLabel}>{t("credentials.list.last_rotated")}</span>
                    <span style={P.detailValue}>{rotated ?? t("credentials.list.never_rotated")}</span>
                  </div>
                  {item.runbook ? (
                    <div style={P.detailItem}>
                      <span style={P.detailLabel}>{t("credentials.list.runbook")}</span>
                      <span style={P.detailValue}><code>{item.runbook}</code></span>
                    </div>
                  ) : null}
                </div>
                <div style={P.actionRow}>
                  {item.rotation.supported && item.rotation.route ? (
                    <a style={P.link} href={item.rotation.route}>{t("credentials.list.rotate")}</a>
                  ) : null}
                  {item.expiry.status === "unknown" ? (
                    <button type="button" className="mrd-chip" disabled title={t("credentials.list.manual_note")}>
                      {t("credentials.list.manual")}
                    </button>
                  ) : null}
                </div>
                {item.expiry.status === "unknown" ? <p style={P.muted}>{t("credentials.list.manual_note")}</p> : null}
              </article>
            );
          })}
        </div>
      </section>

      <FlexRotationCard t={t} language={language} />
      {load.result.source === "mock" ? <p style={P.muted}>{t("credentials.mock_note")}</p> : null}
    </div>
  );
}
